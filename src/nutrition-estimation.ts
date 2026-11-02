import { ValidatedCalorieResearcher, type CalorieResearcher } from "./calorie-researcher.ts";
import { FoodCompositionCatalog, scaleFoodComposition } from "./food-composition.ts";
import type { FatlossToolContext } from "./tools/definition.ts";

export async function estimateFoodNutrition(
    foodDescription: string,
    grams: number | null,
    catalog = new FoodCompositionCatalog(),
    researcher: CalorieResearcher = new ValidatedCalorieResearcher(),
    signal?: AbortSignal,
    ctx?: FatlossToolContext,
) {
    // 本地数据优先：只有缺文件、无可靠匹配或混合菜无法命中时才把描述交给联网子 Agent。
    const match = catalog.lookup(foodDescription);
    if (match.status === "needs_clarification") {
        return { status: "needs_clarification" as const, candidates: match.candidates.map((item) => ({ code: item.code, name: item.name })) };
    }
    if (match.status === "matched" && grams !== null) {
        // 模型只负责理解用户描述；命中食材后的营养换算完全由本地函数完成。
        return {
            status: "estimated" as const,
            sourceType: "local_food_database" as const,
            sourceRef: `china-food-composition-data:${match.item.code}`,
            matchedFoodName: match.item.name,
            amountGrams: grams,
            ...scaleFoodComposition(match.item, grams),
            lowKcal: null,
            highKcal: null,
            confidence: "high" as const,
            assumptions: ["按每 100 克可食部分数据换算"],
            sourceUrls: ["https://github.com/Sanotsu/china-food-composition-data"],
            requiresConfirmation: true,
        };
    }
    if (match.status === "matched") {
        return { status: "needs_clarification" as const, candidates: [{ code: match.item.code, name: match.item.name }], question: "请提供这份食物的大致克数。" };
    }
    // 联网侧只接收菜品描述，不发送画像、体重或数据库记录。
    const web = await researcher.estimateFood(foodDescription, signal, ctx);
    if (web.needsClarification) return { status: "needs_clarification" as const, candidates: [], question: web.clarificationQuestion };
    return {
        status: "estimated" as const,
        sourceType: "web_estimate" as const,
        sourceRef: web.sourceUrls.join("\n"),
        caloriesKcal: web.caloriesKcal,
        proteinG: web.proteinG,
        carbsG: web.carbsG,
        fatG: web.fatG,
        fiberG: web.fiberG,
        lowKcal: web.lowKcal,
        highKcal: web.highKcal,
        confidence: web.confidence,
        assumptions: web.assumptions,
        sourceUrls: web.sourceUrls,
        requiresConfirmation: true,
    };
}
