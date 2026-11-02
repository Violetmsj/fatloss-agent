import { Value } from "typebox/value";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { FatlossTool, FatlossToolContext, FatlossToolResult } from "../core/tools/definition.ts";

// DSH 0.2.1 的原始 JSON Schema 子集不接受 TypeBox 的数值边界等关键字；
// 模型侧只投影其支持的部分，执行前仍用完整 TypeBox schema 校验。
export function schemaForDsh(schema: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "description", "title", "default"]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === "anyOf" || key === "oneOf") result.oneOf = (value as Record<string, unknown>[]).map(schemaForDsh);
        else if (key === "properties") result.properties = Object.fromEntries(Object.entries(value as Record<string, Record<string, unknown>>).map(([name, child]) => [name, schemaForDsh(child)]));
        else if (key === "items") result.items = schemaForDsh(value as Record<string, unknown>);
        else if (allowed.has(key)) result[key] = value;
    }
    return result;
}

interface CanonicalResult { text: string; data: unknown; terminate: boolean; }

export function dshTool(tool: FatlossTool, context: (exec: ToolRunContext) => FatlossToolContext, changed: () => void, settled?: (result: FatlossToolResult, exec: ToolRunContext) => void, lifetime?: AbortSignal): ToolDefinition {
    return {
        name: tool.name, description: tool.description,
        parameters: schemaForDsh(tool.parameters as unknown as Record<string, unknown>) as ToolDefinition["parameters"],
        output: {
            schema: { type: "object", properties: { text: { type: "string" }, data: {}, terminate: { type: "boolean" } }, required: ["text", "data", "terminate"], additionalProperties: false },
            render: (_args, value) => [{ type: "text", text: (value as unknown as CanonicalResult).text }],
            presentationMeta: (_args, value) => (value as unknown as { data: never }).data,
        },
        async execute(args, exec) {
            const signal = lifetime ? AbortSignal.any([exec.signal, lifetime]) : exec.signal;
            signal.throwIfAborted();
            if (!exec.agent) throw new Error("减脂工具必须在减脂会话中调用。");
            if (!Value.Check(tool.parameters, args)) throw new Error("工具参数无效，请根据字段约束补充或修正。");
            const result: FatlossToolResult = await tool.execute(exec.callId, args, signal, undefined, context(exec));
            signal.throwIfAborted();
            settled?.(result, exec);
            if (result.terminate) exec.concludeTurn();
            changed();
            return JSON.parse(JSON.stringify({ text: result.content.map(block => block.text).join("\n"), data: result.details ?? null, terminate: result.terminate === true }));
        },
        presentCall: () => ({ card: "generic", title: tool.label }),
        isConcurrencySafe: () => false,
    };
}
