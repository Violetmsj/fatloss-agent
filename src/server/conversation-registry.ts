import {
  type AgentSession,
  type AgentSessionRuntime,
  CURRENT_SESSION_VERSION,
  type CreateAgentSessionRuntimeFactory,
  type ModelRuntime,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";

import { HttpError } from "./errors.ts";
import { createWebExtensionUI, type WebNotification } from "./extension-ui.ts";

export interface ConversationSummary {
  id: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  createdAt: string;
  modifiedAt: string;
}

interface ActiveConversation {
  runtime: AgentSessionRuntime;
  running: boolean;
  timer?: NodeJS.Timeout;
  notificationListeners: Set<(notification: WebNotification) => void>;
}

/** 一次 prompt 对会话运行时的独占租约；调用方必须在 finally 中 release。 */
export interface PromptLease {
  session: AgentSession;
  release(): void;
  onNotification(listener: (notification: WebNotification) => void): () => void;
}

export interface ConversationSessionRegistryOptions {
  cwd: string;
  modelRuntime: ModelRuntime;
  sessionDir?: string;
  idleTimeoutMs?: number;
  provider?: string;
  modelId?: string;
}

/**
 * 管理 Web 进程中的 pi-agent 会话实例。
 * JSONL 始终由 SessionManager 持久化；本类只缓存正在使用的运行时并负责并发与回收。
 */
export class ConversationSessionRegistry {
  // active 保存已打开运行时；opening 合并同一会话同时到达的首次打开请求。
  private readonly active = new Map<string, ActiveConversation>();
  private readonly opening = new Map<string, Promise<ActiveConversation>>();
  private readonly idleTimeoutMs: number;
  private readonly provider: string;
  private readonly modelId: string;
  private readonly agentDir = getAgentDir();

  constructor(private readonly options: ConversationSessionRegistryOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
    this.provider = options.provider?.trim() || process.env.AGENT_MODEL_PROVIDER?.trim() || "deepseek";
    this.modelId = options.modelId?.trim() || process.env.AGENT_MODEL_ID?.trim() || "deepseek-flash";
  }

  get modelName(): string {
    return `${this.provider}/${this.modelId}`;
  }

  hasConfiguredModel(): boolean {
    return !!this.options.modelRuntime.getModel(this.provider, this.modelId);
  }

  supportsImageInput(): boolean {
    // pi-ai 会依据模型元数据降级不受支持的图片，因此在进入会话前主动阻止静默丢图。
    return this.options.modelRuntime.getModel(this.provider, this.modelId)?.input.includes("image") ?? false;
  }

  async list(): Promise<ConversationSummary[]> {
    const sessions = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    return sessions.map((session) => this.toSummary(session));
  }

  async create(): Promise<ConversationSummary> {
    const manager = SessionManager.create(this.options.cwd, this.options.sessionDir);
    const id = manager.getSessionId();
    const file = manager.getSessionFile();
    if (!file) throw new Error("无法创建会话文件。");
    // SDK 通常等首条助手消息才落盘；Web 需要空会话立即出现在侧栏，因此主动写合法会话头。
    await writeFile(file, `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp: new Date().toISOString(),
      cwd: manager.getCwd(),
    })}\n`, { flag: "wx" });
    const info = await this.requireInfo(id);
    return this.toSummary(info);
  }

  async rename(id: string, name: string): Promise<void> {
    const normalized = name.trim();
    if (!normalized || normalized.length > 80) throw new HttpError(400, "会话名称需为 1 到 80 个字符。", "INVALID_CONVERSATION_NAME");
    const active = this.active.get(id);
    if (active) {
      // 活跃会话必须通过同一个 SessionManager 追加，避免另开实例并发写同一 JSONL。
      active.runtime.session.setSessionName(normalized);
      this.touch(id, active);
      return;
    }
    const info = await this.requireInfo(id);
    SessionManager.open(info.path).appendSessionInfo(normalized);
  }

  async getMessages(id: string) {
    const active = this.active.get(id);
    if (active) {
      this.touch(id, active);
      // getBranch 只返回当前 leaf 对应路径，不把被分叉放弃的历史混入网页。
      return active.runtime.session.sessionManager.getBranch();
    }
    const info = await this.requireInfo(id);
    return SessionManager.open(info.path).getBranch();
  }

  async acquirePrompt(id: string): Promise<PromptLease> {
    const entry = await this.getOrOpen(id);
    // 同一 JSONL 同时只允许一个 prompt；不同会话拥有不同 entry，仍可并行运行。
    if (entry.running) throw new HttpError(409, "该会话正在生成回复，请等待或先停止。", "CONVERSATION_BUSY");
    entry.running = true;
    if (entry.timer) clearTimeout(entry.timer);
    let released = false;
    return {
      session: entry.runtime.session,
      release: () => {
        if (released) return;
        released = true;
        entry.running = false;
        this.touch(id, entry);
      },
      onNotification: (listener) => {
        entry.notificationListeners.add(listener);
        return () => entry.notificationListeners.delete(listener);
      },
    };
  }

  async abort(id: string): Promise<void> {
    const entry = this.active.get(id);
    if (entry?.running) await entry.runtime.session.abort();
  }

  async disposeAll(): Promise<void> {
    // 先等待尚在创建中的运行时，防止它在清空 active 后才注册进来而泄漏。
    await Promise.allSettled(this.opening.values());
    this.opening.clear();
    const entries = [...this.active.values()];
    this.active.clear();
    await Promise.all(entries.map(async (entry) => {
      if (entry.timer) clearTimeout(entry.timer);
      await entry.runtime.dispose();
    }));
  }

  private async getOrOpen(id: string): Promise<ActiveConversation> {
    const existing = this.active.get(id);
    if (existing) {
      this.touch(id, existing);
      return existing;
    }
    // 两个请求同时打开冷会话时复用同一个 Promise，避免创建两套 JSONL 写入者。
    const pending = this.opening.get(id);
    if (pending) return pending;
    const opening = this.openConversation(id);
    this.opening.set(id, opening);
    try {
      return await opening;
    } finally {
      if (this.opening.get(id) === opening) this.opening.delete(id);
    }
  }

  private async openConversation(id: string): Promise<ActiveConversation> {
    const info = await this.requireInfo(id);
    const notificationListeners = new Set<(notification: WebNotification) => void>();
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      // ModelRuntime 由整个服务共享，具体 AgentSession 仍按会话独立创建。
      const services = await createAgentSessionServices({ cwd, agentDir: this.agentDir, modelRuntime: this.options.modelRuntime });
      const model = services.modelRuntime.getModel(this.provider, this.modelId);
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        // Web Agent 只开放项目扩展注册的业务工具，不开放读写文件、执行 shell 等内置工具。
        noTools: "builtin",
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: this.options.cwd,
      agentDir: this.agentDir,
      sessionManager: SessionManager.open(info.path),
      sessionStartEvent: { type: "session_start", reason: "resume" },
    });
    await runtime.session.bindExtensions({
      // SDK 没有 web mode；print 是合法的无终端模式，交互能力由下面的 UI 适配器提供安全默认值。
      mode: "print",
      uiContext: createWebExtensionUI((notification) => {
        if (notificationListeners.size === 0) console.log(`[Agent ${notification.type}] ${notification.message}`);
        for (const listener of notificationListeners) listener(notification);
      }),
    });
    const entry: ActiveConversation = { runtime, running: false, notificationListeners };
    this.active.set(id, entry);
    this.touch(id, entry);
    return entry;
  }

  private touch(id: string, entry: ActiveConversation): void {
    if (entry.timer) clearTimeout(entry.timer);
    // 每次访问刷新空闲计时；运行中的 prompt 永不被空闲清理中途释放。
    entry.timer = setTimeout(() => {
      if (entry.running || this.active.get(id) !== entry) return;
      this.active.delete(id);
      void entry.runtime.dispose().catch((error) => console.error(`释放会话 ${id} 失败`, error));
    }, this.idleTimeoutMs);
    entry.timer.unref();
  }

  private async requireInfo(id: string) {
    // API 只接受服务端列表中存在的 ID，绝不把客户端输入当作文件路径打开。
    if (!/^[0-9a-f-]{20,}$/i.test(id)) throw new HttpError(404, "会话不存在。", "CONVERSATION_NOT_FOUND");
    const info = (await SessionManager.list(this.options.cwd, this.options.sessionDir)).find((session) => session.id === id);
    if (!info) throw new HttpError(404, "会话不存在。", "CONVERSATION_NOT_FOUND");
    return info;
  }

  private toSummary(info: Awaited<ReturnType<typeof SessionManager.list>>[number]): ConversationSummary {
    return {
      id: info.id,
      name: info.name,
      firstMessage: info.firstMessage === "(no messages)" ? "" : info.firstMessage,
      messageCount: info.messageCount,
      createdAt: info.created.toISOString(),
      modifiedAt: info.modified.toISOString(),
    };
  }
}
