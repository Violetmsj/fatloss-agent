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

// 读作“接收任务和延迟，返回一个取消函数”，相当于把 setTimeout/clearTimeout 配成一对。
export type ScheduleMemoryTask = (run: () => void, delayMs: number) => () => void;
const scheduleTask: ScheduleMemoryTask = (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    timer.unref(); // 只剩这个定时器时允许进程退出，不为了后台记忆强行维持应用运行。
    return () => clearTimeout(timer);
};

interface MemoryCoordinatorOptions {
    // 将外部能力作为函数传入；调度器无需知道 pi SDK 怎么读会话或调用模型。
    store: MemoryStore;
    readMessages: () => MemoryMessage[];
    getProfile: () => unknown;
    isIdle: () => boolean;
    extract: (input: string, signal: AbortSignal) => Promise<string>;
    notify: (message: string, type: "info" | "warning") => void;
    schedule?: ScheduleMemoryTask;
}

/** 调度与模型隔离，测试可注入时钟、会话和假模型。每次处理最多十条用户发言。 */
export class MemoryCoordinator {
    private cancelIdle?: () => void;
    private controller?: AbortController;
    private generation = 0; // 会话生命周期编号：切换/停止后，旧任务即使晚返回也不能保存。
    private stopped = false;
    private running?: Promise<void>; // 保存当前任务的 Promise，合并同一时刻的重复触发。
    private readonly schedule: ScheduleMemoryTask;

    constructor(private readonly options: MemoryCoordinatorOptions) {
        this.schedule = options.schedule ?? scheduleTask;
    }

    input(): void {
        this.cancelIdle?.();
        this.cancelIdle = undefined;
    }

    settled(): void {
        if (this.stopped) return;
        this.input();
        if (this.options.store.pending(this.options.readMessages()).length >= 10 && this.options.isIdle()) {
            void this.flush(); // 启动异步处理但不等待，让当前回答结束事件尽快返回。
        } else {
            this.armIdle();
        }
    }

    resume(): void {
        this.stopped = false;
        this.armIdle();
    }

    stop(): void {
        this.stopped = true;
        this.generation++;
        this.input();
        this.controller?.abort();
    }

    private armIdle(): void {
        // 只在有待处理消息时安排空闲任务；新用户输入会取消这个计时器。
        if (this.stopped || this.options.store.pending(this.options.readMessages()).length === 0) return;
        this.cancelIdle?.();
        this.cancelIdle = this.schedule(() => {
            this.cancelIdle = undefined;
            if (this.options.isIdle()) void this.flush();
            else this.armIdle();
        }, 5 * 60 * 1000);
    }

    flush(): Promise<void> {
        // 这是一次后台提取的主流程；已经在执行时，复用同一个 Promise，不再发请求。
        if (this.running) return this.running;
        if (this.stopped || !this.options.isIdle()) return Promise.resolve();
        this.input();
        const messages = this.options.readMessages();
        const pending = this.options.store.pending(messages).slice(0, 10);
        if (pending.length === 0) return Promise.resolve();
        // 在 await 之前固定生命周期编号和数据库版本，回来后分别校验“会话”和“数据”。
        const generation = this.generation;
        const revision = this.options.store.revision;
        const first = messages.findIndex((message) => message.key === pending[0].key);
        const lastUser = messages.findIndex((message) => message.key === pending.at(-1)!.key);
        const nextUser = messages.findIndex((message, index) => index > lastUser && message.role === "user");
        // context 带少量邻近旧消息帮助理解；pendingMessageIds 才是允许产生新证据的范围。
        // 助手回答可帮助解释用户的承接语，但不能作为用户事实的证据来源。
        const input = JSON.stringify({
            timezone: "Asia/Shanghai", pendingMessageIds: pending.map((message) => message.id),
            context: messages.slice(Math.max(0, first - 4), nextUser < 0 ? undefined : nextUser),
            profile: this.options.getProfile(), existingMemories: this.options.store.all(),
            forgottenSourceKeys: this.options.store.forgottenKeys(),
        });
        const controller = new AbortController();
        this.controller = controller;
        const cancelTimeout = this.schedule(() => controller.abort(new Error("记忆提取超过 60 秒。")), 60_000);
        // 即使 provider 不及时响应 signal，取消也会释放调度器；晚到的模型结果不能落库。
        let cancelListener: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
            cancelListener = () => reject(controller.signal.reason ?? new Error("记忆提取已取消。"));
            controller.signal.addEventListener("abort", cancelListener, { once: true });
        });
        this.running = (async () => {
            try {
                // Promise.race 只决定先收到哪个结果，不会自动取消另一项；取消请求依靠 signal。
                const text = await Promise.race([this.options.extract(input, controller.signal), cancelled]);
                if (this.stopped || generation !== this.generation || controller.signal.aborted) return;
                // JSON.parse 负责解析，store.apply 负责结构/证据校验与原子写入，二者不是一回事。
                const result = this.options.store.apply(JSON.parse(text), pending, revision, pending);
                if (result.created + result.updated + result.invalidated > 0) {
                    this.options.notify(`记忆已新增 ${result.created} 条、更新 ${result.updated} 条、失效 ${result.invalidated} 条，可用 /memories 查看。`, "info");
                }
                // 成功后若仍有新消息，下一次空闲再处理；失败不会自动持续重试。
                this.armIdle();
            } catch (error) {
                if (!this.stopped && generation === this.generation) {
                    const detail = error instanceof Error ? error.message : "未知错误";
                    this.options.notify(`长期记忆本次未能整理，将在下次触发时重试。${detail.slice(0, 160)}`, "warning");
                }
            } finally {
                cancelTimeout();
                controller.signal.removeEventListener("abort", cancelListener!);
                if (this.controller === controller) this.controller = undefined;
                this.running = undefined;
            }
        })();
        return this.running;
    }
}

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
