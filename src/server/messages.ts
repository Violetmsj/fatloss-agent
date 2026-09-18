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

export function sessionEntriesToUIMessages(entries: SessionEntry[]): UIMessage[] {
  const messages: UIMessage[] = [];
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
