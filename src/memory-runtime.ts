import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import type { ProfileRepository } from "./database.ts";
import { MemoryStore } from "./memory-store.ts";
import { MEMORY_EXTRACTION_PROMPT, formatMemory, type MemoryMessage } from "./memory.ts";

/** SDK 条目转为业务数据：跳过工具结果、压缩摘要和思考块，避免它们冒充用户原话。 */
export function readMemoryMessages(entries: SessionEntry[], sessionId: string): MemoryMessage[] {
    return entries.flatMap((entry) => {
        if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return [];
        const content = entry.message.content;
        const text = typeof content === "string" ? content : content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        // 分叉会复制条目；不将新 sessionId 放进 key，避免继承的同一原话重复入库。
        const key = createHash("sha256").update(JSON.stringify([entry.id, entry.timestamp, entry.message.role, text])).digest("hex");
        return [{ id: entry.id, key, sessionId, timestamp: entry.timestamp, role: entry.message.role, text }];
    });
}

export { MemoryCoordinator, type ScheduleMemoryTask } from "./memory-coordinator.ts";
import { MemoryCoordinator } from "./memory-coordinator.ts";

/** SDK 接线层：把事件、模型调用与 UI 接到可单独测试的 MemoryCoordinator。 */
export function registerMemoryRuntime(pi: ExtensionAPI, store: MemoryStore, profiles: ProfileRepository): void {
    let ctx: ExtensionContext | undefined;
    const coordinator = new MemoryCoordinator({
        store,
        readMessages: () => ctx ? readMemoryMessages(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId()) : [],
        getProfile: () => profiles.get(),
        isIdle: () => !!ctx?.isIdle() && !ctx.hasPendingMessages(),
        notify: (message, type) => ctx?.ui.notify(message, type),
        extract: async (input, signal) => {
            const current = ctx;
            if (!current?.model) throw new Error("当前会话没有可用于提取记忆的模型。");
            // 独立模型请求，不调用主 Agent 的 prompt，也不附带工具；只返回候选 JSON 文本。
            const response = await current.modelRegistry.complete(current.model, {
                systemPrompt: MEMORY_EXTRACTION_PROMPT,
                messages: [{ role: "user", content: input, timestamp: store.now() }],
            }, { signal });
            if (response.stopReason === "error" || response.stopReason === "aborted" || response.stopReason === "length") {
                throw new Error("模型未完整返回记忆候选。");
            }
            return response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        },
    });
    pi.on("session_start", (_event, context) => {
        coordinator.stop();
        ctx = context;
        coordinator.resume();
    });
    pi.on("input", (_event, context) => { ctx = context; coordinator.input(); });
    // 切换/分叉可能被其他扩展取消；下一次正常提问恢复调度，不永久停在 stopped 状态。
    pi.on("before_agent_start", (_event, context) => {
        ctx = context;
        coordinator.resume();
        coordinator.input();
    });
    pi.on("agent_settled", (_event, context) => { ctx = context; coordinator.settled(); });
    pi.on("session_before_switch", () => coordinator.stop());
    pi.on("session_before_fork", () => coordinator.stop());
    pi.on("session_tree", (_event, context) => {
        coordinator.stop();
        ctx = context;
        coordinator.resume();
    });
    pi.on("session_shutdown", () => coordinator.stop());
    // 每次模型调用都重新查有效记忆。返回的快照只用于本次请求，不追加到持久化聊天历史。
    pi.on("context", (event, context) => {
        const raw = readMemoryMessages(context.sessionManager.getBranch(), context.sessionManager.getSessionId());
        const latest = raw.filter((message) => message.role === "user").at(-1);
        return { messages: [...event.messages, {
            role: "custom" as const, customType: "fatloss-memory-context", display: false,
            content: `${store.context()}\n当前用户消息标识（供记忆工具引用）：${latest?.id ?? "无"}`,
            timestamp: store.now(),
        }] };
    });
    pi.registerCommand("memories", {
        description: "查看长期记忆及来源、状态、期限；/memories all 查看失效记录，可在末尾加页码",
        handler: async (args, context) => {
            const parts = args.trim().split(/\s+/);
            const all = parts[0] === "all";
            const pageText = all ? parts[1] : parts[0];
            const page = pageText ? Number(pageText) : 1;
            if (!Number.isInteger(page) || page < 1) { context.ui.notify("用法：/memories [all] [页码]", "warning"); return; }
            const { items, total } = store.list({ status: all ? "all" : "active", limit: 10, offset: (page - 1) * 10 });
            context.ui.notify(`长期记忆：共 ${total} 条，第 ${page} 页\n${items.map(formatMemory).join("\n") || "暂无记忆"}`, "info");
        },
    });
}
