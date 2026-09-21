import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileRepository } from "../src/database.ts";
import type { ProfileInput } from "../src/profile.ts";
import { createServerApp } from "../src/server/app.ts";
import { HttpError } from "../src/server/errors.ts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ConversationSessionRegistry, PromptLease } from "../src/server/conversation-registry.ts";

const validProfile: ProfileInput = {
  gender: "男",
  age: 30,
  weightKg: 80,
  heightCm: 178,
  bodyFatPct: 25,
  waistCm: 90,
  hipCm: null,
  targetBodyFatPct: 18,
  dailyEnergyDeficitKcal: 500,
  dietExercisePreference: "吃动平衡派",
  activityLevel: "轻度",
  jobType: "轻体力工作",
  favoriteExercises: ["步行", "跑步"],
  equipment: ["不使用器械"],
  stairResponse: "呼吸有点局促，但可以快速恢复",
  focusArea: "全身",
  trainingDays: ["一", "三", "五"],
};

const unusedRegistry = {
  list: async () => [],
  create: async () => { throw new Error("not used"); },
  remove: async () => { throw new Error("not used"); },
} as unknown as ConversationSessionRegistry;

async function withServer<T>(profiles: ProfileRepository, operation: (baseUrl: string) => Promise<T>, registry = unusedRegistry): Promise<T> {
  const { app } = createServerApp({ registry, profiles, webDistPath: join(tmpdir(), "missing-web-dist") });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("画像预览不写库，确认后原子保存且原有画像可继续读取", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-server-"));
  const databasePath = join(directory, "profile.sqlite");
  const profiles = new ProfileRepository(databasePath);
  try {
    await withServer(profiles, async (baseUrl) => {
      const preview = await fetch(`${baseUrl}/api/profile/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validProfile),
      });
      assert.equal(preview.status, 200);
      const previewBody = await preview.json() as { profile: Record<string, unknown> };
      assert.equal("goal" in previewBody.profile, false);
      assert.equal(profiles.get(), null);

      const save = await fetch(`${baseUrl}/api/profile`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validProfile),
      });
      assert.equal(save.status, 200);
      const saveBody = await save.json() as { profile: Record<string, unknown> };
      assert.equal("goal" in saveBody.profile, false);
      assert.equal(profiles.get()?.age, 30);

      const get = await fetch(`${baseUrl}/api/profile`);
      const getBody = await get.json() as { profile: Record<string, unknown>; options: Record<string, unknown> };
      assert.equal("goal" in getBody.profile, false);
      assert.equal("goals" in getBody.options, false);
    });
    profiles.close();

    const reopened = new ProfileRepository(databasePath);
    try {
      assert.deepEqual({ ...reopened.get(), updatedAt: undefined }, { ...validProfile, updatedAt: undefined });
    } finally {
      reopened.close();
    }
  } finally {
    if (profiles.db.isOpen) profiles.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("画像 API 拒绝缺失字段、越界值和器械互斥冲突", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-server-invalid-"));
  const profiles = new ProfileRepository(join(directory, "profile.sqlite"));
  try {
    await withServer(profiles, async (baseUrl) => {
      for (const body of [
        {},
        { ...validProfile, age: 17 },
        { ...validProfile, activityLevel: null },
        { ...validProfile, activityLevel: "经常锻炼" },
        { ...validProfile, activityLevel: undefined, activityFrequency: "偶尔锻炼" },
        { ...validProfile, activityFrequency: "偶尔锻炼" },
        { ...validProfile, equipment: ["哑铃", "不使用器械"] },
      ]) {
        const response = await fetch(`${baseUrl}/api/profile/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_PROFILE");
      }
      const removedGoal = await fetch(`${baseUrl}/api/profile/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validProfile, goal: "减脂" }),
      });
      assert.equal(removedGoal.status, 400);
      const error = await removedGoal.json() as { error: { code: string; message: string } };
      assert.equal(error.error.code, "INVALID_PROFILE");
      assert.match(error.error.message, /计划目标字段已移除/);
      assert.equal(profiles.get(), null);
    });
  } finally {
    profiles.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("聊天 API 要求先建档，并把假 AgentSession 输出为 UI Message Stream", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-server-stream-"));
  const profiles = new ProfileRepository(join(directory, "profile.sqlite"));
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const lease = {
    session: {
      subscribe(callback: (event: AgentSessionEvent) => void) { listener = callback; return () => {}; },
      async prompt() {
        listener?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "测试回复" } } as AgentSessionEvent);
        listener?.({ type: "agent_settled" } as AgentSessionEvent);
      },
      async abort() {},
    },
    release() {},
    onNotification: () => () => {},
  } as unknown as PromptLease;
  const registry = { acquirePrompt: async () => lease, supportsImageInput: () => true } as unknown as ConversationSessionRegistry;
  try {
    await withServer(profiles, async (baseUrl) => {
      const request = () => fetch(`${baseUrl}/api/conversations/01a0b3f0-eae5-76a0-a9e6-daa60f1ee406/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "你好" }] }] }),
      });
      const blocked = await request();
      assert.equal(blocked.status, 412);

      profiles.save(validProfile);
      const streamed = await request();
      assert.equal(streamed.status, 200);
      assert.match(streamed.headers.get("content-type") ?? "", /text\/event-stream/);
      const body = await streamed.text();
      assert.match(body, /测试回复/);
      assert.match(body, /\[DONE\]/);
    }, registry);
  } finally {
    profiles.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("聊天 API 在模型未声明视觉能力时拒绝图片", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-server-image-"));
  const profiles = new ProfileRepository(join(directory, "profile.sqlite"));
  const registry = {
    supportsImageInput: () => false,
    acquirePrompt: async () => { throw new Error("不应获取会话"); },
  } as unknown as ConversationSessionRegistry;
  try {
    profiles.save(validProfile);
    await withServer(profiles, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/01a0b3f0-eae5-76a0-a9e6-daa60f1ee406/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [
          { type: "file", mediaType: "image/png", url: "data:image/png;base64,aGk=" },
        ] }] }),
      });
      assert.equal(response.status, 422);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "IMAGE_INPUT_UNSUPPORTED");
    }, registry);
  } finally {
    profiles.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("删除会话 API 成功返回 204 空响应，并把 registry 的 404 转成业务错误", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fatloss-server-delete-"));
  const profiles = new ProfileRepository(join(directory, "profile.sqlite"));
  const removed: string[] = [];
  const registry = {
    remove: async (id: string) => {
      if (id !== "01a0b3f0-eae5-76a0-a9e6-daa60f1ee406") throw new HttpError(404, "会话不存在。", "CONVERSATION_NOT_FOUND");
      removed.push(id);
    },
  } as unknown as ConversationSessionRegistry;
  try {
    await withServer(profiles, async (baseUrl) => {
      const ok = await fetch(`${baseUrl}/api/conversations/01a0b3f0-eae5-76a0-a9e6-daa60f1ee406`, { method: "DELETE" });
      assert.equal(ok.status, 204);
      assert.equal(await ok.text(), "");
      const missing = await fetch(`${baseUrl}/api/conversations/01a0b3f0-eae5-76a0-a9e6-000000000000`, { method: "DELETE" });
      assert.equal(missing.status, 404);
      assert.equal((await missing.json() as { error: { code: string } }).error.code, "CONVERSATION_NOT_FOUND");
    }, registry);
    assert.deepEqual(removed, ["01a0b3f0-eae5-76a0-a9e6-daa60f1ee406"]);
  } finally {
    profiles.close();
    await rm(directory, { recursive: true, force: true });
  }
});
