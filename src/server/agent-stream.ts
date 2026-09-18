import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createUIMessageStream, type UIMessageChunk, type UIMessageStreamWriter } from "ai";

import type { PromptLease } from "./conversation-registry.ts";
import { toErrorMessage } from "./errors.ts";
import type { ChatImage } from "./messages.ts";
import { getToolTitle, presentToolError, presentToolInput, presentToolOutput } from "./tool-presentation.ts";

export interface AgentStreamOptions {
  lease: PromptLease;
  prompt: string;
  images?: ChatImage[];
  signal: AbortSignal;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
}

/** 把一个 pi-agent prompt 包装成浏览器可消费的 AI SDK UI Message Stream。 */
export function createAgentMessageStream(options: AgentStreamOptions) {
  // 空闲超时防止 provider 无事件卡死；硬超时限制整次生成的最长生命周期。
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

      // AI SDK 要求每段文本显式 start/end；工具调用前也要先结束正在输出的文本段。
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
        // prompt.finally 和 agent_settled 都可能尝试结束流，这里统一去重。
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
      // 扩展 notify 不写入聊天历史，只作为本次响应的临时 data 事件发送。
      const offNotification = options.lease.onNotification((notification) => {
        writer.write({
          type: "data-notification",
          data: notification,
          transient: true,
        } as UIMessageChunk);
      });
      // subscribe 是同步回调且 SDK 不替监听器捕获异常，因此必须在回调内部兜底。
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
        // pi-agent 只会把 PromptOptions.images 作为多模态内容持久化并传给模型，不能拼进文本提示词。
        await options.lease.session.prompt(options.prompt, options.images?.length ? { images: options.images } : undefined);
        complete();
      } catch (error) {
        complete(abortReason ? undefined : new Error("Agent 回复失败，请检查模型配置或稍后重试。", { cause: error }));
      } finally {
        // 无论成功、错误或中断都释放计时器、订阅和会话互斥锁。
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

/** 仅映射网页需要的文本、工具和完成事件；thinking 事件会自然被忽略。 */
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
    // toolCallId 是开始与结果之间的稳定关联键，前端据此更新同一张工具卡片。
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
      // 网页得到可展示原因，终端同时保留工具名和调用 ID 便于追查原始会话。
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
