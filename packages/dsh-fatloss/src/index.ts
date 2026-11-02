import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { z as schema } from "zod";
import { FatlossService, type FatlossConfiguration } from "./service.ts";
import { FatlossController } from "./controller.ts";
import { memoryMessage } from "./messages.ts";
import { registerFatlossCompactionReady } from "./compaction-ready.ts";
import type { MemoryMessage } from "../../../src/memory.ts";
import type {} from "@deepseek-ai/dsh-session-projection";

export { FatlossController } from "./controller.ts";
export type { PluginStatus } from "./types.ts";

export const name = "fatloss-host";
export const inject = ["sessionProjections", "agents", "tools", "llm", "profileContext"];
export const Config = z.object({
    dataDirectory: z.string().description("独立减脂数据目录；留空使用 DSH 存储目录"),
    embeddingApiKey: z.string().role("secret").description("百炼嵌入 API Key，可改用 DASHSCOPE_API_KEY 环境变量"),
    embeddingUrl: z.string().description("百炼嵌入接口 URL，可改用 DASHSCOPE_EMBEDDING_URL"),
    chromaHost: z.string().description("Chroma 主机，默认 localhost"),
    chromaPort: z.number().min(1).max(65535).description("Chroma 端口，默认 8000"),
});

declare module "@deepseek-ai/dsh-session-projection/types" {
    interface SessionProjectionStateMap { "fatloss:messages": { sessionId: string; messages: MemoryMessage[] }; }
}

export function apply(ctx: Context, config: FatlossConfiguration): void {
    registerFatlossCompactionReady(ctx);
    new FatlossService(ctx, config);
    new FatlossController(ctx);
    ctx.sessionProjections.register({
        key: "fatloss:messages", stateVersion: 1,
        stateSchema: schema.object({ sessionId: schema.string(), messages: schema.array(schema.object({
            id: schema.string(), key: schema.string(), sessionId: schema.string(), timestamp: schema.string(),
            role: schema.enum(["user", "assistant"]), text: schema.string(),
        })) }),
        init: header => ({ sessionId: header.id, messages: [] }),
        apply: (state, event) => {
            const message = memoryMessage(event, state.sessionId);
            return message ? { ...state, messages: [...state.messages, message] } : state;
        },
    });
}
