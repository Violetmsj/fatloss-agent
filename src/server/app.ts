import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ChromaClient } from "chromadb";
import express, { type ErrorRequestHandler } from "express";
import { pipeUIMessageStreamToResponse } from "ai";

import { ProfileRepository } from "../database.ts";
import { profileFormDefinition } from "../profile-form.ts";
import { calculateEstimate, formatProfile, type ProfileInput, validateProfile } from "../profile.ts";
import { createAgentMessageStream } from "./agent-stream.ts";
import type { ConversationSessionRegistry } from "./conversation-registry.ts";
import { HttpError, toErrorMessage } from "./errors.ts";
import { getLastUserPrompt, sessionEntriesToUIMessages } from "./messages.ts";

export interface CreateServerAppOptions {
  registry: ConversationSessionRegistry;
  profiles?: ProfileRepository;
  webDistPath?: string;
}

/**
 * 组装 Web 服务及其依赖。函数不负责监听端口，便于测试直接挂载 app，
 * 也便于生产入口在退出时统一释放 registry 和 SQLite 连接。
 */
export function createServerApp(options: CreateServerAppOptions) {
  const app = express();
  const profiles = options.profiles ?? new ProfileRepository();
  app.disable("x-powered-by");
  // 图片以 base64 放在 JSON 中；30MB 可容纳 4 张各 5MB 的图片及编码开销。
  app.use(express.json({ limit: "30mb" }));

  // 返回当前画像，同时下发选项和边界，使前端不必复制后端业务常量。
  app.get("/api/profile", (_request, response) => {
    response.json({ profile: profiles.get(), ...profileFormDefinition });
  });

  // 仅校验并计算预览，不写入 SQLite；用于保存前的确认弹窗。
  app.post("/api/profile/preview", (request, response) => {
    const input = parseProfileInput(request.body);
    const preview = { ...input, updatedAt: new Date().toISOString() };
    response.json({ profile: preview, summary: formatProfile(preview), estimate: calculateEstimate(input) });
  });

  // 再次执行服务端校验后覆盖单用户画像，并返回与预览一致的估算结构。
  app.put("/api/profile", (request, response) => {
    const input = parseProfileInput(request.body);
    const profile = profiles.save(input);
    response.json({ profile, summary: formatProfile(profile), estimate: calculateEstimate(profile) });
  });

  // 会话元数据来自 pi-agent 的 JSONL 目录，列表默认按最近修改时间排列。
  app.get("/api/conversations", async (_request, response) => {
    response.json({ conversations: await options.registry.list() });
  });

  // 创建只有会话头的持久化 JSONL，用户尚未发送消息时也能出现在侧栏。
  app.post("/api/conversations", async (_request, response) => {
    response.status(201).json({ conversation: await options.registry.create() });
  });

  // 修改显示名称；名称作为 session_info 条目追加，不改写历史消息。
  app.patch("/api/conversations/:id", async (request, response) => {
    await options.registry.rename(request.params.id, String(request.body?.name ?? ""));
    response.status(204).end();
  });

  // 只恢复当前分支，并转换为 AI SDK UIMessage；thinking 和原始工具结果不会下发。
  app.get("/api/conversations/:id/messages", async (request, response) => {
    const entries = await options.registry.getMessages(request.params.id);
    response.json({ messages: sessionEntriesToUIMessages(entries) });
  });

  // 启动一次 Agent prompt，并把 pi 事件实时转成 AI SDK UI Message Stream。
  app.post("/api/conversations/:id/messages", async (request, response) => {
    if (!profiles.get()) throw new HttpError(412, "请先完成减脂建档。", "PROFILE_REQUIRED");
    const prompt = typeof request.body?.message === "string"
      ? { text: request.body.message.trim(), images: [] }
      : getLastUserPrompt(request.body?.messages);
    if (!prompt?.text) throw new HttpError(400, "消息不能为空。", "EMPTY_MESSAGE");
    // 能力检查放在获取会话租约前，校验失败时不会占用会话锁或写入半条历史。
    if (prompt.images.length > 0 && !options.registry.supportsImageInput()) {
      throw new HttpError(422, "当前模型未声明图片输入能力，请在模型配置中启用 image 输入。", "IMAGE_INPUT_UNSUPPORTED");
    }

    const lease = await options.registry.acquirePrompt(request.params.id);
    const controller = new AbortController();
    let ended = false;
    // 浏览器停止生成、刷新或断网时通知 Agent 中止，避免模型继续运行和占用会话锁。
    const abort = () => {
      if (!ended) controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      await pipeUIMessageStreamToResponse({
        response,
        stream: createAgentMessageStream({ lease, prompt: prompt.text, images: prompt.images, signal: controller.signal }),
      });
    } finally {
      ended = true;
      request.off("aborted", abort);
      response.off("close", abort);
    }
  });

  // 核心依赖（模型、SQLite）异常时返回 503；Chroma 是可选能力，只单独报告状态。
  app.get("/api/health", async (_request, response) => {
    let sqlite: "ok" | "error" = "ok";
    try {
      profiles.get();
    } catch {
      sqlite = "error";
    }
    const host = process.env.CHROMA_HOST?.trim() || "localhost";
    const port = Number(process.env.CHROMA_PORT ?? "8000");
    let chroma: "ok" | "unavailable" = "unavailable";
    try {
      await new ChromaClient({ host, port }).heartbeat();
      chroma = "ok";
    } catch {
      // 健康检查只报告状态，不让可选的知识库服务拖垮 Web 服务。
    }
    const model = options.registry.hasConfiguredModel() ? "configured" : "missing";
    const ok = sqlite === "ok" && model === "configured";
    response.status(ok ? 200 : 503).json({
      service: "ok",
      model: { status: model, name: options.registry.modelName },
      sqlite,
      chroma: { status: chroma, host, port },
    });
  });

  const webDistPath = options.webDistPath ?? resolve(process.cwd(), "web", "dist");
  if (existsSync(webDistPath)) {
    // 生产模式下由 Express 同源托管构建产物；非 API 路径回退到 Vue Router 入口。
    app.use(express.static(webDistPath));
    app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(resolve(webDistPath, "index.html")));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    // 流式响应已经开始后不能再改 HTTP 状态或响应头，错误交给流协议处理。
    if (response.headersSent) return;
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const message = toErrorMessage(error);
    const validation = /无效|需为|选择数量不正确|至少|不高于|之间/.test(message);
    console.error(error);
    response.status(validation ? 400 : 500).json({
      error: {
        code: validation ? "INVALID_PROFILE" : "INTERNAL_ERROR",
        message: validation ? message : "服务处理失败，请稍后重试。",
      },
    });
  };
  app.use(errorHandler);

  return { app, profiles };
}

function parseProfileInput(value: unknown): ProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "画像表单格式无效。", "INVALID_PROFILE");
  }
  try {
    // 前端校验只改善交互；所有写入和预览都以这里的后端校验为准。
    validateProfile(value as ProfileInput);
  } catch (error) {
    throw new HttpError(400, toErrorMessage(error), "INVALID_PROFILE");
  }
  return value as ProfileInput;
}
