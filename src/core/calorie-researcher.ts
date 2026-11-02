import type { FatlossToolContext } from "./tools/definition.ts";
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
    estimateFood(description: string, signal?: AbortSignal, ctx?: FatlossToolContext): Promise<FoodWebEstimate>;
    findExerciseMet(description: string, signal?: AbortSignal, ctx?: FatlossToolContext): Promise<ExerciseMetMatch>;
}

export type ResearchKind = "food" | "exercise";

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

export type ResearchTurn = (kind: ResearchKind, prompt: string, signal?: AbortSignal, ctx?: FatlossToolContext) => Promise<string>;

export class ValidatedCalorieResearcher implements CalorieResearcher {
    constructor(private readonly runTurn: ResearchTurn = async (kind, prompt, signal, ctx) => {
        if (!ctx?.research) throw new Error("当前宿主未配置联网检索能力");
        return ctx.research(kind, prompt, signal);
    }) {}

    async estimateFood(description: string, signal?: AbortSignal, ctx?: FatlossToolContext): Promise<FoodWebEstimate> {
        return this.runValidated("food", description, validateFood, signal, ctx);
    }

    async findExerciseMet(description: string, signal?: AbortSignal, ctx?: FatlossToolContext): Promise<ExerciseMetMatch> {
        return this.runValidated("exercise", description, validateExercise, signal, ctx);
    }

    private async runValidated<T>(kind: ResearchKind, description: string, validate: (value: unknown) => T, signal?: AbortSignal, ctx?: FatlossToolContext): Promise<T> {
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
