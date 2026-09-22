import {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import webSearch from "@pi-plugins/websearch";

import type { CalorieConfidence } from "./daily-record.ts";

export interface FoodWebEstimate {
    caloriesKcal: number;
    lowKcal: number;
    highKcal: number;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sourceUrls: string[];
    assumptions: string[];
    confidence: CalorieConfidence;
    needsClarification: boolean;
    clarificationQuestion: string | null;
}

export interface ExerciseMetMatch {
    met: number;
    metLow: number;
    metHigh: number;
    sourceUrls: string[];
    assumptions: string[];
    confidence: CalorieConfidence;
    needsClarification: boolean;
    clarificationQuestion: string | null;
}

export interface CalorieResearcher {
    estimateFood(description: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<FoodWebEstimate>;
    findExerciseMet(description: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<ExerciseMetMatch>;
}

type ResearchKind = "food" | "exercise";

const CHILD_SYSTEM_PROMPT = `你是热量资料检索器。只能使用 web_search 查找公开资料，不得请求或推断用户身份、体重、画像或数据库内容。
优先权威或原始来源，明确区分事实与假设。最终只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。`;
export const RESEARCH_TOOL_ALLOWLIST = ["web_search"] as const;

function textFromMessages(messages: unknown[]): string {
    const last = [...messages].reverse().find((message) => (message as { role?: unknown })?.role === "assistant") as { content?: unknown } | undefined;
    if (!last) throw new Error("估算子 Agent 没有返回结果");
    if (typeof last.content === "string") return last.content;
    if (!Array.isArray(last.content)) throw new Error("估算子 Agent 返回格式无效");
    return last.content.flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string"
        ? [(block as { text: string }).text]
        : []).join("\n");
}

function parseJson(text: string): unknown {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(trimmed);
}

function finiteNumber(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name}无效`);
    return value;
}

function nullableNumber(value: unknown, name: string): number | null {
    return value === null ? null : finiteNumber(value, name);
}

function common(value: unknown) {
    // 不信任模型返回值：来源、假设、置信度和澄清状态都必须逐项通过运行时校验。
    if (!value || typeof value !== "object") throw new Error("结果不是 JSON 对象");
    const record = value as Record<string, unknown>;
    const confidence = record.confidence;
    if (confidence !== "low" && confidence !== "medium" && confidence !== "high") throw new Error("confidence 无效");
    if (!Array.isArray(record.sourceUrls) || !record.sourceUrls.every((item) => typeof item === "string" && /^https?:\/\//.test(item))) throw new Error("sourceUrls 无效");
    if (!Array.isArray(record.assumptions) || !record.assumptions.every((item) => typeof item === "string")) throw new Error("assumptions 无效");
    if (typeof record.needsClarification !== "boolean") throw new Error("needsClarification 无效");
    if (record.clarificationQuestion !== null && typeof record.clarificationQuestion !== "string") throw new Error("clarificationQuestion 无效");
    return { record, confidence: confidence as CalorieConfidence, sourceUrls: record.sourceUrls as string[], assumptions: record.assumptions as string[] };
}

function validateFood(value: unknown): FoodWebEstimate {
    const { record, confidence, sourceUrls, assumptions } = common(value);
    const caloriesKcal = finiteNumber(record.caloriesKcal, "caloriesKcal");
    const lowKcal = finiteNumber(record.lowKcal, "lowKcal");
    const highKcal = finiteNumber(record.highKcal, "highKcal");
    if (lowKcal > caloriesKcal || caloriesKcal > highKcal) throw new Error("热量区间无效");
    return {
        caloriesKcal, lowKcal, highKcal,
        proteinG: nullableNumber(record.proteinG, "proteinG"),
        carbsG: nullableNumber(record.carbsG, "carbsG"),
        fatG: nullableNumber(record.fatG, "fatG"),
        fiberG: nullableNumber(record.fiberG, "fiberG"),
        sourceUrls, assumptions, confidence,
        needsClarification: record.needsClarification as boolean,
        clarificationQuestion: record.clarificationQuestion as string | null,
    };
}

function validateExercise(value: unknown): ExerciseMetMatch {
    const { record, confidence, sourceUrls, assumptions } = common(value);
    const met = finiteNumber(record.met, "met");
    const metLow = finiteNumber(record.metLow, "metLow");
    const metHigh = finiteNumber(record.metHigh, "metHigh");
    if (metLow < 1 || metLow > met || met > metHigh) throw new Error("MET 区间无效");
    return {
        met, metLow, metHigh, sourceUrls, assumptions, confidence,
        needsClarification: record.needsClarification as boolean,
        clarificationQuestion: record.clarificationQuestion as string | null,
    };
}

export type ResearchTurn = (kind: ResearchKind, prompt: string, signal?: AbortSignal, ctx?: ExtensionContext) => Promise<string>;

export class PiCalorieResearcher implements CalorieResearcher {
    constructor(private readonly runTurn: ResearchTurn = runRestrictedResearchTurn) {}

    async estimateFood(description: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<FoodWebEstimate> {
        return this.runValidated("food", description, validateFood, signal, ctx);
    }

    async findExerciseMet(description: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<ExerciseMetMatch> {
        return this.runValidated("exercise", description, validateExercise, signal, ctx);
    }

    private async runValidated<T>(kind: ResearchKind, description: string, validate: (value: unknown) => T, signal?: AbortSignal, ctx?: ExtensionContext): Promise<T> {
        const first = await this.runTurn(kind, promptFor(kind, description), signal, ctx);
        try {
            return validate(parseJson(first));
        } catch (error) {
            // 最多允许一次格式修复；第二次仍非法就向上抛错，绝不把不完整结果写入数据库。
            const repaired = await this.runTurn(kind, `修复下面结果，只返回符合原 schema 的 JSON。错误：${error instanceof Error ? error.message : "格式错误"}\n原结果：${first}`, signal, ctx);
            return validate(parseJson(repaired));
        }
    }
}

function promptFor(kind: ResearchKind, description: string): string {
    if (kind === "food") {
        return `检索并估算这份食物的总营养：${description}\n返回字段：caloriesKcal, lowKcal, highKcal, proteinG, carbsG, fatG, fiberG, sourceUrls, assumptions, confidence(low|medium|high), needsClarification, clarificationQuestion。未知营养素用 null。`;
    }
    return `只为这项运动匹配 Compendium 风格的 MET，不计算热量：${description}\n返回字段：met, metLow, metHigh, sourceUrls, assumptions, confidence(low|medium|high), needsClarification, clarificationQuestion。`;
}

export async function runRestrictedResearchTurn(kind: ResearchKind, prompt: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<string> {
    if (!ctx?.model) throw new Error("当前没有可用于联网估算的模型");
    const loader = await createResearchResourceLoader();
    // 每次估算使用不持久化的全新会话，不继承主 Agent 的消息历史和数据库上下文。
    const { session } = await createAgentSession({
        model: ctx.model,
        thinkingLevel: "low",
        tools: [...RESEARCH_TOOL_ALLOWLIST],
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(process.cwd()),
    });
    let timedOut = false;
    const abort = () => void session.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        abort();
    }, 45_000);
    timeout.unref();
    try {
        await session.prompt(prompt);
        if (signal?.aborted) throw new Error("估算已取消");
        if (timedOut) throw new Error("联网估算超时");
        return textFromMessages(session.messages as unknown[]);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        session.dispose();
    }
}

export async function createResearchResourceLoader(): Promise<DefaultResourceLoader> {
    // 禁用项目扩展、Skill、提示模板和 AGENTS/SYSTEM 上下文，只注入固定版本的 web_search。
    // 配合 createAgentSession 的 tools 白名单形成双重限制，避免子 Agent 获得写库能力。
    const loader = new DefaultResourceLoader({
        cwd: process.cwd(), agentDir: getAgentDir(), noExtensions: true, noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true,
        systemPrompt: CHILD_SYSTEM_PROMPT,
        extensionFactories: [{ name: "websearch", factory: webSearch }],
    });
    await loader.reload();
    return loader;
}
