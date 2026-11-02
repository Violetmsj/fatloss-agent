import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { FatlossTool, FatlossToolContext } from "../tools/definition.ts";
import { readMemoryMessages } from "../memory-runtime.ts";
import { runRestrictedResearchTurn } from "./calorie-researcher.ts";

export function createPiToolContext(ctx: ExtensionContext): FatlossToolContext {
    return {
        mode: ctx.mode,
        ui: ctx.ui,
        modelName: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        readMessages: () => readMemoryMessages(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId()),
        research: (kind, prompt, signal) => runRestrictedResearchTurn(kind, prompt, signal, ctx),
        generateText: async (systemPrompt, input, signal) => {
            if (!ctx.model) throw new Error("当前会话没有可用模型。");
            const response = await ctx.modelRegistry.complete(ctx.model, {
                systemPrompt, messages: [{ role: "user", content: input, timestamp: Date.now() }],
            }, { signal });
            if (["error", "aborted", "length"].includes(response.stopReason)) throw new Error("模型未完整返回结果。");
            return response.content.filter(block => block.type === "text").map(block => block.text).join("\n");
        },
    };
}

export function piTool(tool: FatlossTool): ToolDefinition {
    return {
        ...tool,
        execute: (id: string, args: unknown, signal: AbortSignal | undefined, update: ((result: import("../tools/definition.ts").FatlossToolResult) => void) | undefined, ctx: ExtensionContext) =>
            tool.execute(id, args, signal, update, createPiToolContext(ctx)),
    };
}
