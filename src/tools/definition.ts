import type { Static, TSchema } from "typebox";
import type { MemoryMessage } from "../memory.ts";

/** 两种宿主只提供业务需要的能力，不把会话 SDK 传入领域操作。 */
export interface FatlossToolContext {
    mode?: string;
    modelName?: string | null;
    generateText?: (systemPrompt: string, input: string, signal: AbortSignal) => Promise<string>;
    research?: (kind: "food" | "exercise", prompt: string, signal?: AbortSignal) => Promise<string>;
    readMessages?: () => MemoryMessage[];
    reportUrl?: (id: string) => string;
    ask?: (questions: import("./ask-user.ts").AskUserQuestion[], signal?: AbortSignal) => Promise<{
        answers: { id: string; value: string; label: string; wasCustom: boolean }[];
        cancelled: boolean;
        pending?: boolean;
    }>;
    ui?: {
        select: (title: string, options: string[]) => Promise<string | undefined>;
        input: (title: string, placeholder?: string) => Promise<string | undefined>;
    };
}

export interface FatlossToolResult<D = unknown> {
    content: { type: "text"; text: string }[];
    details: D;
    terminate?: boolean;
}

export interface FatlossTool<T extends TSchema = TSchema, D = unknown> {
    name: string;
    label: string;
    description: string;
    parameters: T;
    execute: (id: string, args: Static<T>, signal: AbortSignal | undefined,
        update: ((result: FatlossToolResult<D>) => void) | undefined, context: FatlossToolContext) => Promise<FatlossToolResult<D>>;
}

export function defineTool<T extends TSchema, D = unknown>(tool: FatlossTool<T, D>): FatlossTool<T, D> & FatlossTool<any, any> {
    return tool as FatlossTool<T, D> & FatlossTool<any, any>;
}
