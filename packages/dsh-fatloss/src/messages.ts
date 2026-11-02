import { createHash } from "node:crypto";
import { deriveEventMessage, isAppendSurfaceEvent, type SessionEvent } from "@deepseek-ai/dsh-session";
import type { MemoryMessage } from "../../../src/memory.ts";

/** 只接纳真实用户和已提交助手文本，插件快照/通知不能充当记忆证据。 */
export function memoryMessage(event: SessionEvent, sessionId: string): MemoryMessage | undefined {
    if (!isAppendSurfaceEvent(event)) return;
    const message = deriveEventMessage(event);
    if (!message || (message.role !== "user" && message.role !== "assistant")) return;
    if (message.role === "user" && !["user", "user-question-reply"].includes(message.source.kind)) return;
    const text = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (!text) return;
    return {
        id: `dsh:${message.id}`, sessionId: `dsh:${sessionId}`, role: message.role,
        timestamp: new Date(event.time).toISOString(), text,
        key: `dsh:${createHash("sha256").update(JSON.stringify([message.id, event.time, message.role, text])).digest("hex")}`,
    };
}
