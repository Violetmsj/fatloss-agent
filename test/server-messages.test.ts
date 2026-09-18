import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { getLastUserPrompt, getLastUserText, MAX_CHAT_IMAGE_BYTES, sessionEntriesToUIMessages } from "../src/server/messages.ts";

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

test("历史转换恢复用户图片为可展示的 Data URL", () => {
  const entries = [
    { type: "message", id: "u-image", parentId: null, timestamp: "2026-01-01", message: { role: "user", content: [
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "text", text: "分析这张图" },
    ] } },
  ] as unknown as SessionEntry[];

  const messages = sessionEntriesToUIMessages(entries);
  assert.deepEqual(messages[0]?.parts, [
    { type: "file", mediaType: "image/png", filename: "图片 1", url: "data:image/png;base64,aGVsbG8=" },
    { type: "text", text: "分析这张图" },
  ]);
});

test("只读取请求中的最后一条用户文本", () => {
  assert.equal(getLastUserText([
    { role: "user", parts: [{ type: "text", text: "旧消息" }] },
    { role: "assistant", parts: [{ type: "text", text: "回复" }] },
    { role: "user", parts: [{ type: "text", text: " 新消息 " }] },
  ]), "新消息");
});

test("读取最后一条用户消息的文字和图片，并为纯图片补默认提示", () => {
  const prompt = getLastUserPrompt([
    { role: "user", parts: [{ type: "text", text: "旧消息" }] },
    { role: "user", parts: [{ type: "file", mediaType: "image/jpeg", filename: "meal.jpg", url: "data:image/jpeg;base64,aGk=" }] },
  ]);
  assert.deepEqual(prompt, {
    text: "请分析这些图片。",
    images: [{ type: "image", data: "aGk=", mimeType: "image/jpeg" }],
  });
});

test("图片请求拒绝远程地址、非法类型、超量和超大数据", () => {
  const message = (parts: unknown[]) => [{ role: "user", parts }];
  assert.throws(() => getLastUserPrompt(message([{ type: "file", mediaType: "image/png", url: "https://example.com/a.png" }])), /不能使用远程地址/);
  assert.throws(() => getLastUserPrompt(message([{ type: "file", mediaType: "image/svg+xml", url: "data:image\/svg\+xml;base64,PHN2Zz4=" }])), /仅支持/);
  assert.throws(() => getLastUserPrompt(message(Array.from({ length: 5 }, () => ({ type: "file", mediaType: "image/png", url: "data:image/png;base64,aA==" })))), /最多上传 4 张/);
  const oversized = Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1).toString("base64");
  assert.throws(() => getLastUserPrompt(message([{ type: "file", mediaType: "image/png", url: `data:image/png;base64,${oversized}` }])), /不能超过 5MB/);
});
