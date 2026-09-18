import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { getLastUserText, sessionEntriesToUIMessages } from "../src/server/messages.ts";

test("历史转换恢复文本和工具状态并隐藏 thinking", () => {
  const entries = [
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01", message: { role: "user", content: [{ type: "text", text: "今天怎么吃？" }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01", message: { role: "assistant", content: [
      { type: "thinking", thinking: "不应展示" },
      { type: "text", text: "我先看看画像。" },
      { type: "toolCall", id: "tool-1", name: "get_current_profile", arguments: {} },
      { type: "toolCall", id: "tool-2", name: "create_memory", arguments: {} },
    ] } },
    { type: "message", id: "t1", parentId: "a1", timestamp: "2026-01-01", message: { role: "toolResult", toolCallId: "tool-1", toolName: "get_current_profile", content: [{ type: "text", text: "敏感原始结果" }], isError: false } },
    { type: "message", id: "t2", parentId: "t1", timestamp: "2026-01-01", message: { role: "toolResult", toolCallId: "tool-2", toolName: "create_memory", content: [{ type: "text", text: "记忆有效期必须晚于用户陈述时间。" }], isError: true } },
  ] as unknown as SessionEntry[];

  const messages = sessionEntriesToUIMessages(entries);
  assert.equal(messages.length, 2);
  assert.equal(JSON.stringify(messages).includes("不应展示"), false);
  assert.equal(JSON.stringify(messages).includes("敏感原始结果"), false);
  const tool = messages[1]?.parts.find((part) => part.type === "dynamic-tool");
  assert.equal(tool?.state, "output-available");
  assert.equal(tool?.title, "读取减脂画像");
  const failedTool = messages[1]?.parts.filter((part) => part.type === "dynamic-tool").find((part) => part.toolCallId === "tool-2");
  assert.equal(failedTool?.state, "output-error");
  assert.match(failedTool?.errorText ?? "", /记忆有效期必须晚于用户陈述时间/);
});

test("只读取请求中的最后一条用户文本", () => {
  assert.equal(getLastUserText([
    { role: "user", parts: [{ type: "text", text: "旧消息" }] },
    { role: "assistant", parts: [{ type: "text", text: "回复" }] },
    { role: "user", parts: [{ type: "text", text: " 新消息 " }] },
  ]), "新消息");
});
