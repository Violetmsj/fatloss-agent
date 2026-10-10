import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime, type ModelRuntime as ModelRuntimeType, SessionManager } from "@earendil-works/pi-coding-agent";

import { ConversationSessionRegistry } from "../src/server/conversation-registry.ts";

test("会话列表支持创建空白持久化会话、重命名并拒绝非法 ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-sessions-"));
  const registry = new ConversationSessionRegistry({
    cwd: directory,
    sessionDir: join(directory, "sessions"),
    modelRuntime: { getModel: () => undefined } as unknown as ModelRuntimeType,
  });
  try {
    const created = await registry.create();
    assert.equal(created.messageCount, 0);
    assert.equal(created.firstMessage, "");
    assert.equal((await registry.list()).length, 1);

    await registry.rename(created.id, "第一周复盘");
    assert.equal((await registry.list())[0]?.name, "第一周复盘");
    assert.equal((await registry.getMessages(created.id)).some((entry) => entry.type === "message"), false);

    await assert.rejects(() => registry.getMessages("../../data/fatloss.sqlite"), /会话不存在/);
  } finally {
    await registry.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("删除会话后 JSONL 文件消失、列表清空，且拒绝删除不存在或非法 ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-sessions-"));
  const sessionDir = join(directory, "sessions");
  const registry = new ConversationSessionRegistry({
    cwd: directory,
    sessionDir,
    modelRuntime: { getModel: () => undefined } as unknown as ModelRuntimeType,
  });
  try {
    const created = await registry.create();
    assert.equal((await readdir(sessionDir)).length, 1);

    await registry.remove(created.id);
    assert.equal((await registry.list()).length, 0);
    assert.deepEqual(await readdir(sessionDir), []);
    await assert.rejects(() => registry.getMessages(created.id), /会话不存在/);
    await assert.rejects(() => registry.remove(created.id), /会话不存在/);
    await assert.rejects(() => registry.remove("../../data/fatloss.sqlite"), /会话不存在/);
  } finally {
    await registry.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("思考强度仅写入当前会话，并在空白会话重新打开后恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-thinking-sessions-"));
  const sessionDir = join(directory, "sessions");
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  modelRuntime.registerProvider("test-thinking", {
    name: "Test thinking",
    baseUrl: "http://127.0.0.1:9",
    apiKey: "$TEST_THINKING_KEY",
    api: "openai-completions",
    models: [{
      id: "test-model",
      name: "Test model",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000,
      maxTokens: 1_000,
      thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
    }],
  });
  const registry = new ConversationSessionRegistry({
    cwd: directory,
    sessionDir,
    modelRuntime,
    provider: "test-thinking",
    modelId: "test-model",
  });
  try {
    const created = await registry.create();
    assert.deepEqual((await registry.getThinkingState(created.id)).availableLevels, ["off", "low", "high", "max"]);

    const lease = await registry.acquirePrompt(created.id);
    await assert.rejects(() => registry.setThinkingLevel(created.id, "off"), /正在生成/);
    lease.release();

    const changed = await registry.setThinkingLevel(created.id, "off");
    assert.equal(changed.level, "off");
    await assert.rejects(() => registry.setThinkingLevel(created.id, "medium"), /不支持/);
    const file = (await SessionManager.list(directory, sessionDir))[0]?.path;
    assert(file);
    assert.match(await readFile(file, "utf8"), /"thinkingLevel":"off"/);

    await registry.disposeAll();
    assert.equal((await registry.getThinkingState(created.id)).level, "off");
  } finally {
    await registry.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
