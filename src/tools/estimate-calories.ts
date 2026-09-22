import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { PiCalorieResearcher, type CalorieResearcher } from "../calorie-researcher.ts";
import { calculateMetRange, normalizeWearableCalories } from "../exercise-calculation.ts";
import { FoodCompositionCatalog } from "../food-composition.ts";
import { estimateFoodNutrition } from "../nutrition-estimation.ts";
import { ProfileRepository } from "../database.ts";

export interface EstimationToolDependencies {
    catalog?: FoodCompositionCatalog;
    researcher?: CalorieResearcher;
}

export function createEstimationTools(repository: ProfileRepository, dependencies: EstimationToolDependencies = {}) {
    const catalog = dependencies.catalog ?? new FoodCompositionCatalog();
    const researcher = dependencies.researcher ?? new PiCalorieResearcher();
    return [
        defineTool({
            name: "estimate_food_nutrition",
            label: "估算食物营养",
            description: "在用户没有提供包装/商家热量时估算食物营养。克数明确时优先查询本地中国食物成分数据并确定性换算；无可靠匹配或混合菜时使用受限联网子 Agent。返回估算必须向用户展示并确认，确认前不得写入。",
            parameters: Type.Object({
                foodDescription: Type.String({ minLength: 1 }),
                grams: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
            }, { additionalProperties: false }),
            async execute(_id, input, signal, _update, ctx) {
                const estimate = await estimateFoodNutrition(input.foodDescription, input.grams ?? null, catalog, researcher, signal, ctx);
                // recordDraft 使用新增工具的字段名，供主 Agent 在用户确认后原样组装；这里只返回草稿，不写库。
                const result = estimate.status !== "estimated" ? estimate : {
                    ...estimate,
                    recordDraft: {
                        foodName: "matchedFoodName" in estimate ? estimate.matchedFoodName : input.foodDescription,
                        amount: input.grams ?? null,
                        unit: input.grams === undefined ? null : "克",
                        caloriesKcal: estimate.caloriesKcal,
                        proteinG: estimate.proteinG,
                        carbsG: estimate.carbsG,
                        fatG: estimate.fatG,
                        fiberG: estimate.fiberG,
                        calorieSourceType: estimate.sourceType,
                        calorieSourceRef: estimate.sourceRef,
                        calorieEstimateLowKcal: estimate.lowKcal,
                        calorieEstimateHighKcal: estimate.highKcal,
                        calorieConfidence: estimate.confidence,
                        calorieEstimationNote: estimate.assumptions.join("；"),
                    },
                };
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
            },
        }),
        defineTool({
            name: "estimate_exercise_calories",
            label: "估算运动消耗",
            description: "计算运动活动热量。若用户提供手表/手环热量则按口径处理；否则受限联网子 Agent 只匹配 MET，程序用固定公式计算。任何转换值或估算值都必须经用户确认后才能写入。",
            parameters: Type.Object({
                exerciseDescription: Type.String({ minLength: 1 }),
                durationMinutes: Type.Number({ exclusiveMinimum: 0 }),
                reportedCaloriesKcal: Type.Optional(Type.Number({ minimum: 0 })),
                reportedCalorieBasis: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("total"), Type.Literal("unknown")])),
            }, { additionalProperties: false }),
            async execute(_id, input, signal, _update, ctx) {
                const profile = repository.get();
                if (!profile) throw new Error("尚未建立减脂画像，请先完成建档。");
                const hasReported = input.reportedCaloriesKcal !== undefined || input.reportedCalorieBasis !== undefined;
                if (hasReported && (input.reportedCaloriesKcal === undefined || input.reportedCalorieBasis === undefined)) {
                    throw new Error("设备热量数值和口径必须同时提供");
                }
                if (input.reportedCaloriesKcal !== undefined && input.reportedCalorieBasis !== undefined) {
                    // 设备路径不启动联网子 Agent；活动/总量/未知三种口径都由确定性函数统一处理。
                    const estimate = normalizeWearableCalories(input.reportedCaloriesKcal, input.reportedCalorieBasis, profile.weightKg, input.durationMinutes);
                    const result = {
                        status: "estimated", sourceType: "wearable", sourceRef: "用户的运动手表/手环",
                        reportedCaloriesKcal: input.reportedCaloriesKcal, reportedCalorieBasis: input.reportedCalorieBasis,
                        metValue: null, ...estimate,
                        recordDraft: {
                            exerciseName: input.exerciseDescription, durationMinutes: input.durationMinutes,
                            caloriesBurnedKcal: estimate.caloriesKcal, calorieSourceType: "wearable",
                            calorieSourceRef: "用户的运动手表/手环", calorieEstimateLowKcal: estimate.lowKcal,
                            calorieEstimateHighKcal: estimate.highKcal, calorieConfidence: estimate.confidence,
                            calorieEstimationNote: estimate.note, metValue: null,
                            reportedCaloriesKcal: input.reportedCaloriesKcal, reportedCalorieBasis: input.reportedCalorieBasis,
                        },
                    };
                    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
                }
                // 无设备数据时，联网子 Agent 只返回 MET；体重和时长不会发给它，乘法在下一步本地完成。
                const match = await researcher.findExerciseMet(input.exerciseDescription, signal, ctx);
                if (match.needsClarification) {
                    const result = { status: "needs_clarification", question: match.clarificationQuestion, assumptions: match.assumptions };
                    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
                }
                const estimate = calculateMetRange(match.met, match.metLow, match.metHigh, profile.weightKg, input.durationMinutes, match.confidence);
                const result = {
                    status: "estimated", sourceType: "met_formula", sourceRef: match.sourceUrls.join("\n"),
                    reportedCaloriesKcal: null, reportedCalorieBasis: null, metValue: match.met,
                    sourceUrls: match.sourceUrls, assumptions: match.assumptions, ...estimate,
                    recordDraft: {
                        exerciseName: input.exerciseDescription, durationMinutes: input.durationMinutes,
                        caloriesBurnedKcal: estimate.caloriesKcal, calorieSourceType: "met_formula",
                        calorieSourceRef: match.sourceUrls.join("\n"), calorieEstimateLowKcal: estimate.lowKcal,
                        calorieEstimateHighKcal: estimate.highKcal, calorieConfidence: estimate.confidence,
                        calorieEstimationNote: [...match.assumptions, estimate.note].join("；"), metValue: match.met,
                        reportedCaloriesKcal: null, reportedCalorieBasis: null,
                    },
                };
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
            },
        }),
    ];
}
