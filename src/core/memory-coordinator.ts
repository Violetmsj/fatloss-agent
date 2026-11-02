import type { MemoryMessage } from "./memory.ts";
import { MemoryStore } from "./memory-store.ts";

// 读作“接收任务和延迟，返回一个取消函数”，相当于把 setTimeout/clearTimeout 配成一对。
export type ScheduleMemoryTask = (run: () => void, delayMs: number) => () => void;
const scheduleTask: ScheduleMemoryTask = (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    timer.unref(); // 只剩这个定时器时允许进程退出，不为了后台记忆强行维持应用运行。
    return () => clearTimeout(timer);
};

interface MemoryCoordinatorOptions {
    // 将外部能力作为函数传入；调度器无需知道宿主怎么读会话或调用模型。
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

