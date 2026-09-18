import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createUIMessageStream, type UIMessageChunk, type UIMessageStreamWriter } from "ai";

import type { PromptLease } from "./conversation-registry.ts";
import { toErrorMessage } from "./errors.ts";
import { getToolTitle, presentToolError, presentToolInput, presentToolOutput } from "./tool-presentation.ts";

export interface AgentStreamOptions {
  lease: PromptLease;
  prompt: string;
  signal: AbortSignal;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
}

export function createAgentMessageStream(options: AgentStreamOptions) {
  const idleTimeoutMs = options.idleTimeoutMs ?? Number(process.env.CHAT_IDLE_TIMEOUT_MS ?? 60_000);
  const hardTimeoutMs = options.hardTimeoutMs ?? Number(process.env.CHAT_HARD_TIMEOUT_MS ?? 5 * 60_000);

  return createUIMessageStream({
    onError: () => "Agent 回复失败，请稍后重试。",
    execute: async ({ writer }) => {
      const messageId = randomUUID();
      let textSequence = 0;
      let activeTextId: string | undefined;
      let finished = false;
      let abortReason: string | undefined;
      let idleTimer: NodeJS.Timeout | undefined;
      let hardTimer: NodeJS.Timeout | undefined;

      const closeText = () => {
        if (!activeTextId) return;
        writer.write({ type: "text-end", id: activeTextId });
        activeTextId = undefined;
      };
      const ensureText = () => {
        if (!activeTextId) {
          activeTextId = `${messageId}-text-${++textSequence}`;
          writer.write({ type: "text-start", id: activeTextId });
        }
        return activeTextId;
      };
      const complete = (error?: unknown) => {
        if (finished) return;
        finished = true;
        closeText();
        if (error) {
          writer.write({ type: "error", errorText: toErrorMessage(error) });
          writer.setOutcome({ status: "failed", error });
        } else if (abortReason) {
          writer.write({ type: "abort", reason: abortReason });
          writer.setOutcome({ status: "aborted" });
        } else {
          writer.write({ type: "finish", finishReason: "stop" });
          writer.setOutcome({ status: "completed" });
        }
      };
      const abort = (reason: string) => {
        if (abortReason || finished) return;
        abortReason = reason;
        void options.lease.session.abort().catch((error) => console.error("中止 Agent 失败", error));
      };
      const refreshIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => abort("Agent 长时间没有响应，已停止本次生成。"), idleTimeoutMs);
        idleTimer.unref();
      };

      writer.write({ type: "start", messageId });
      refreshIdle();
      hardTimer = setTimeout(() => abort("本次生成超过最长时间，已停止。"), hardTimeoutMs);
      hardTimer.unref();

      const onAbort = () => abort("用户已停止生成。");
      options.signal.addEventListener("abort", onAbort, { once: true });
      const offNotification = options.lease.onNotification((notification) => {
        writer.write({
          type: "data-notification",
          data: notification,
          transient: true,
        } as UIMessageChunk);
      });
      const unsubscribe = options.lease.session.subscribe((event) => {
        try {
          refreshIdle();
          translateAgentEvent(event, writer, {
            ensureText,
            closeText,
            complete,
          });
        } catch (error) {
          abortReason = "处理 Agent 事件失败，已停止。";
          void options.lease.session.abort();
          complete(error);
        }
      });

      try {
        await options.lease.session.prompt(options.prompt);
        complete();
      } catch (error) {
        complete(abortReason ? undefined : new Error("Agent 回复失败，请检查模型配置或稍后重试。", { cause: error }));
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        options.signal.removeEventListener("abort", onAbort);
        unsubscribe();
        offNotification();
        options.lease.release();
      }
    },
  });
}

interface TranslationState {
  ensureText(): string;
  closeText(): void;
  complete(error?: unknown): void;
}

function translateAgentEvent(
  event: AgentSessionEvent,
  writer: UIMessageStreamWriter,
  state: TranslationState,
): void {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_start") state.ensureText();
    if (update.type === "text_delta") writer.write({ type: "text-delta", id: state.ensureText(), delta: update.delta });
    if (update.type === "text_end") state.closeText();
    return;
  }

  if (event.type === "tool_execution_start") {
    state.closeText();
    writer.write({
      type: "tool-input-available",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      title: getToolTitle(event.toolName),
      input: presentToolInput(event.toolName, event.args),
      dynamic: true,
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    if (event.isError) {
      const errorText = presentToolError(event.toolName, event.result);
      console.error(`[Agent 工具失败] ${event.toolName} (${event.toolCallId})：${errorText}`);
      writer.write({
        type: "tool-output-error",
        toolCallId: event.toolCallId,
        errorText,
        dynamic: true,
      });
    } else {
      writer.write({
        type: "tool-output-available",
        toolCallId: event.toolCallId,
        output: presentToolOutput(event.toolName),
        dynamic: true,
      });
    }
    return;
  }

  if (event.type === "agent_settled") state.complete();
}
