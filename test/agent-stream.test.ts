import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";

import { createAgentMessageStream } from "../src/server/agent-stream.ts";
import type { PromptLease } from "../src/server/conversation-registry.ts";

function fakeLease(events: AgentSessionEvent[]) {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  let released = 0;
  let unsubscribed = 0;
  const session = {
    subscribe(callback: (event: AgentSessionEvent) => void) {
      listener = callback;
      return () => { unsubscribed++; };
    },
    async prompt() {
      for (const event of events) listener?.(event);
    },
    async abort() {},
  };
  return {
    lease: {
      session,
      release: () => { released++; },
      onNotification: () => () => {},
    } as unknown as PromptLease,
    counts: () => ({ released, unsubscribed }),
  };
}

test("图片通过 prompt options 原样传给 pi-agent", async () => {
  let received: unknown;
  const lease = {
    session: {
      subscribe: () => () => {},
      async prompt(text: string, options: unknown) { received = { text, options }; },
      async abort() {},
    },
    release() {},
    onNotification: () => () => {},
  } as unknown as PromptLease;
  const images = [{ type: "image" as const, data: "aGk=", mimeType: "image/png" }];

  await readChunks(createAgentMessageStream({ lease, prompt: "看看", images, signal: new AbortController().signal }));

  assert.deepEqual(received, { text: "看看", options: { images } });
});

async function readChunks(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test("pi 事件映射为文本与工具流并只完成一次", async () => {
  const events = [
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "隐藏" } },
    { type: "message_update", assistantMessageEvent: { type: "text_start" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你好" } },
    { type: "message_update", assistantMessageEvent: { type: "text_end" } },
    { type: "tool_execution_start", toolCallId: "call-1", toolName: "search_fatloss_knowledge", args: { question: "蛋白质" } },
    { type: "tool_execution_end", toolCallId: "call-1", toolName: "search_fatloss_knowledge", result: {}, isError: false },
    { type: "agent_settled" },
  ] as unknown as AgentSessionEvent[];
  const { lease, counts } = fakeLease(events);
  const chunks = await readChunks(createAgentMessageStream({ lease, prompt: "测试", signal: new AbortController().signal }));

  assert.equal(chunks.filter((chunk) => chunk.type === "finish").length, 1);
  assert.equal(chunks.some((chunk) => JSON.stringify(chunk).includes("隐藏")), false);
  assert.equal(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "你好"), true);
  assert.equal(chunks.some((chunk) => chunk.type === "tool-input-available" && chunk.toolCallId === "call-1"), true);
  assert.equal(chunks.some((chunk) => chunk.type === "tool-output-available" && chunk.toolCallId === "call-1"), true);
  assert.deepEqual(counts(), { released: 1, unsubscribed: 1 });
});

test("客户端中断会调用 session.abort 并释放订阅", async () => {
  const controller = new AbortController();
  let aborts = 0;
  let released = 0;
  let unsubscribed = 0;
  let rejectPrompt: ((error: Error) => void) | undefined;
  const lease = {
    session: {
      subscribe: () => () => { unsubscribed++; },
      prompt: () => new Promise<void>((_resolve, reject) => { rejectPrompt = reject; }),
      async abort() { aborts++; rejectPrompt?.(new Error("aborted")); },
    },
    release: () => { released++; },
    onNotification: () => () => {},
  } as unknown as PromptLease;

  const reading = readChunks(createAgentMessageStream({ lease, prompt: "测试", signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const chunks = await reading;
  assert.equal(aborts, 1);
  assert.equal(released, 1);
  assert.equal(unsubscribed, 1);
  assert.equal(chunks.some((chunk) => chunk.type === "abort"), true);
  assert.equal(chunks.some((chunk) => chunk.type === "error"), false);
});

test("工具失败向网页和服务日志保留具体原因", async () => {
  const events = [
    { type: "tool_execution_start", toolCallId: "call-memory", toolName: "create_memory", args: {} },
    { type: "tool_execution_end", toolCallId: "call-memory", toolName: "create_memory", result: {
      content: [{ type: "text", text: "记忆有效期必须晚于用户陈述时间。" }],
    }, isError: true },
    { type: "agent_settled" },
  ] as unknown as AgentSessionEvent[];
  const { lease } = fakeLease(events);
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => { logs.push(args.join(" ")); };
  try {
    const chunks = await readChunks(createAgentMessageStream({ lease, prompt: "测试", signal: new AbortController().signal }));
    const error = chunks.find((chunk) => chunk.type === "tool-output-error");
    assert.match(error?.errorText ?? "", /记忆有效期必须晚于用户陈述时间/);
  } finally {
    console.error = original;
  }
  assert.equal(logs.some((line) => line.includes("create_memory") && line.includes("记忆有效期")), true);
});
