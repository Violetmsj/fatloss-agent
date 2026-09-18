import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { DynamicToolUIPart, UIMessage } from "ai";

import { getToolTitle, presentToolError, presentToolInput, presentToolOutput } from "./tool-presentation.ts";

type ContentBlock = Record<string, unknown> & { type?: string };

function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((block): block is ContentBlock => !!block && typeof block === "object") : [];
}

function textParts(content: unknown): UIMessage["parts"] {
  return contentBlocks(content).flatMap((block) => block.type === "text" && typeof block.text === "string"
    ? [{ type: "text" as const, text: block.text }]
    : []);
}

/**
 * 将 pi 当前分支恢复成 AI SDK UIMessage。
 * 只保留人机文本和可关联的工具卡片，不向浏览器发送 thinking 或成功工具的原始结果。
 */
export function sessionEntriesToUIMessages(entries: SessionEntry[]): UIMessage[] {
  const messages: UIMessage[] = [];
  // 工具调用和结果在 JSONL 中是不同 entry，先按 toolCallId 保存卡片引用再回填状态。
  const tools = new Map<string, DynamicToolUIPart>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "user") {
      const parts = textParts(message.content);
      if (parts.length > 0) messages.push({ id: entry.id, role: "user", parts });
      continue;
    }

    if (message.role === "assistant") {
      const parts: UIMessage["parts"] = [];
      for (const block of contentBlocks(message.content)) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          parts.push({ type: "text", text: block.text });
        }
        // 未处理 thinking block：它仍可留在本地 JSONL，但不会成为 Web 消息的一部分。
        if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
          const part: DynamicToolUIPart = {
            type: "dynamic-tool",
            toolCallId: block.id,
            toolName: block.name,
            title: getToolTitle(block.name),
            state: "input-available",
            input: presentToolInput(block.name, block.arguments),
          };
          tools.set(block.id, part);
          parts.push(part);
        }
      }
      if (parts.length > 0) messages.push({ id: entry.id, role: "assistant", parts });
      continue;
    }

    if (message.role === "toolResult") {
      const part = tools.get(message.toolCallId);
      if (!part) continue;
      if (message.isError) {
        Object.assign(part, { state: "output-error", errorText: presentToolError(message.toolName, message.content) });
      } else {
        Object.assign(part, { state: "output-available", output: presentToolOutput(message.toolName) });
      }
    }
  }

  return messages;
}

export function getLastUserText(messages: unknown): string | null {
  // DefaultChatTransport 会携带 UIMessage 历史；后端只把最后一条用户文本交给 session.prompt。
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []).join("\n").trim();
    return text || null;
  }
  return null;
}
