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

export class ConversationSessionRegistry {
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

  async list(): Promise<ConversationSummary[]> {
    const sessions = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    return sessions.map((session) => this.toSummary(session));
  }

  async create(): Promise<ConversationSummary> {
    const manager = SessionManager.create(this.options.cwd, this.options.sessionDir);
    const id = manager.getSessionId();
    const file = manager.getSessionFile();
    if (!file) throw new Error("无法创建会话文件。");
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
      return active.runtime.session.sessionManager.getBranch();
    }
    const info = await this.requireInfo(id);
    return SessionManager.open(info.path).getBranch();
  }

  async acquirePrompt(id: string): Promise<PromptLease> {
    const entry = await this.getOrOpen(id);
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
      const services = await createAgentSessionServices({ cwd, agentDir: this.agentDir, modelRuntime: this.options.modelRuntime });
      const model = services.modelRuntime.getModel(this.provider, this.modelId);
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
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
    entry.timer = setTimeout(() => {
      if (entry.running || this.active.get(id) !== entry) return;
      this.active.delete(id);
      void entry.runtime.dispose().catch((error) => console.error(`释放会话 ${id} 失败`, error));
    }, this.idleTimeoutMs);
    entry.timer.unref();
  }

  private async requireInfo(id: string) {
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
