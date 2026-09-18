import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { ConversationSessionRegistry } from "../src/server/conversation-registry.ts";

test("会话列表支持创建空白持久化会话、重命名并拒绝非法 ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-sessions-"));
  const registry = new ConversationSessionRegistry({
    cwd: directory,
    sessionDir: join(directory, "sessions"),
    modelRuntime: { getModel: () => undefined } as unknown as ModelRuntime,
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
