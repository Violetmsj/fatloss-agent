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
import { getLastUserText, sessionEntriesToUIMessages } from "./messages.ts";

export interface CreateServerAppOptions {
  registry: ConversationSessionRegistry;
  profiles?: ProfileRepository;
  webDistPath?: string;
}

export function createServerApp(options: CreateServerAppOptions) {
  const app = express();
  const profiles = options.profiles ?? new ProfileRepository();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/profile", (_request, response) => {
    response.json({ profile: profiles.get(), ...profileFormDefinition });
  });

  app.post("/api/profile/preview", (request, response) => {
    const input = parseProfileInput(request.body);
    const preview = { ...input, updatedAt: new Date().toISOString() };
    response.json({ profile: preview, summary: formatProfile(preview), estimate: calculateEstimate(input) });
  });

  app.put("/api/profile", (request, response) => {
    const input = parseProfileInput(request.body);
    const profile = profiles.save(input);
    response.json({ profile, summary: formatProfile(profile), estimate: calculateEstimate(profile) });
  });

  app.get("/api/conversations", async (_request, response) => {
    response.json({ conversations: await options.registry.list() });
  });

  app.post("/api/conversations", async (_request, response) => {
    response.status(201).json({ conversation: await options.registry.create() });
  });

  app.patch("/api/conversations/:id", async (request, response) => {
    await options.registry.rename(request.params.id, String(request.body?.name ?? ""));
    response.status(204).end();
  });

  app.get("/api/conversations/:id/messages", async (request, response) => {
    const entries = await options.registry.getMessages(request.params.id);
    response.json({ messages: sessionEntriesToUIMessages(entries) });
  });

  app.post("/api/conversations/:id/messages", async (request, response) => {
    if (!profiles.get()) throw new HttpError(412, "请先完成减脂建档。", "PROFILE_REQUIRED");
    const prompt = typeof request.body?.message === "string"
      ? request.body.message.trim()
      : getLastUserText(request.body?.messages);
    if (!prompt) throw new HttpError(400, "消息不能为空。", "EMPTY_MESSAGE");

    const lease = await options.registry.acquirePrompt(request.params.id);
    const controller = new AbortController();
    let ended = false;
    const abort = () => {
      if (!ended) controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      await pipeUIMessageStreamToResponse({
        response,
        stream: createAgentMessageStream({ lease, prompt, signal: controller.signal }),
      });
    } finally {
      ended = true;
      request.off("aborted", abort);
      response.off("close", abort);
    }
  });

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
    app.use(express.static(webDistPath));
    app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(resolve(webDistPath, "index.html")));
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
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
    validateProfile(value as ProfileInput);
  } catch (error) {
    throw new HttpError(400, toErrorMessage(error), "INVALID_PROFILE");
  }
  return value as ProfileInput;
}
