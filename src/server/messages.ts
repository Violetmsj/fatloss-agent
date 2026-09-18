import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { DynamicToolUIPart, UIMessage } from "ai";

import { HttpError } from "./errors.ts";
import { getToolTitle, presentToolError, presentToolInput, presentToolOutput } from "./tool-presentation.ts";

type ContentBlock = Record<string, unknown> & { type?: string };

// 上传边界必须由服务端再次执行，不能只依赖可被绕过的浏览器 accept 和前端校验。
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const CHAT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export interface ChatImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ChatPrompt {
  text: string;
  images: ChatImage[];
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((block): block is ContentBlock => !!block && typeof block === "object") : [];
}

function textParts(content: unknown): UIMessage["parts"] {
  const parts: UIMessage["parts"] = [];
  let imageIndex = 0;
  for (const block of contentBlocks(content)) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text });
    }
    if (block.type === "image" && typeof block.data === "string" && isAllowedImageMimeType(block.mimeType)) {
      // pi 会话保存裸 base64，AI SDK 的 FileUIPart 则需要完整 Data URL 才能在浏览器中恢复预览。
      parts.push({
        type: "file",
        mediaType: block.mimeType,
        filename: `图片 ${++imageIndex}`,
        url: `data:${block.mimeType};base64,${block.data}`,
      });
    }
  }
  return parts;
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

export function getLastUserPrompt(messages: unknown): ChatPrompt | null {
  // 前端只发送最新消息；这里仍从末尾查找，兼容 AI SDK 的默认消息请求格式。
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []).join("\n").trim();
    const fileParts = parts.filter((part): part is Record<string, unknown> => !!part && typeof part === "object" && (part as { type?: unknown }).type === "file");
    if (fileParts.length > MAX_CHAT_IMAGES) {
      throw new HttpError(400, `单次最多上传 ${MAX_CHAT_IMAGES} 张图片。`, "TOO_MANY_IMAGES");
    }
    // 纯图片消息仍需一段文字驱动 Agent，同时该提示会随图片一起写入 pi 会话历史。
    const images = fileParts.map(parseImagePart);
    if (!text && images.length === 0) return null;
    return { text: text || "请分析这些图片。", images };
  }
  return null;
}

/** 保留旧的纯文本读取入口，供既有调用方和测试兼容使用。 */
export function getLastUserText(messages: unknown): string | null {
  return getLastUserPrompt(messages)?.text ?? null;
}

function isAllowedImageMimeType(value: unknown): value is typeof CHAT_IMAGE_MIME_TYPES[number] {
  return typeof value === "string" && (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

function parseImagePart(part: Record<string, unknown>): ChatImage {
  const mediaType = typeof part.mediaType === "string" ? part.mediaType.toLowerCase() : "";
  if (!isAllowedImageMimeType(mediaType)) {
    throw new HttpError(400, "仅支持 JPEG、PNG、WebP 和 GIF 图片。", "INVALID_IMAGE_TYPE");
  }
  if (typeof part.url !== "string") {
    throw new HttpError(400, "图片数据格式无效。", "INVALID_IMAGE_DATA");
  }
  const prefix = `data:${mediaType};base64,`;
  // 只接收与声明 MIME 完全一致的 Data URL，明确拒绝远程 URL、blob URL 和 MIME 偷换。
  if (!part.url.startsWith(prefix)) {
    throw new HttpError(400, "图片必须使用本地 base64 数据，不能使用远程地址。", "INVALID_IMAGE_DATA");
  }
  const data = part.url.slice(prefix.length);
  if (!isStrictBase64(data)) {
    throw new HttpError(400, "图片 base64 数据无效。", "INVALID_IMAGE_DATA");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength > MAX_CHAT_IMAGE_BYTES) {
    throw new HttpError(400, "每张图片不能超过 5MB。", "IMAGE_TOO_LARGE");
  }
  return { type: "image", data, mimeType: mediaType };
}

function isStrictBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  // Buffer.from 会宽松容忍部分非法输入，重新编码对比可保证收到的是规范 base64。
  return Buffer.from(value, "base64").toString("base64") === value;
}
