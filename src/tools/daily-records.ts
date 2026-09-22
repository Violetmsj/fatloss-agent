import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { DailyRecordStore } from "../daily-record-store.ts";
import type { ExerciseEntryInput, FoodEntryInput } from "../daily-record.ts";
import { ProfileRepository } from "../database.ts";

const nullableText = Type.Union([Type.String(), Type.Null()]);
const nullableNonNegative = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);
const nullablePositive = Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]);
const confidence = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Null()]);

const foodFields = {
    mealType: Type.Union([Type.Literal("早餐"), Type.Literal("午餐"), Type.Literal("晚餐"), Type.Literal("加餐")]),
    foodName: Type.String({ minLength: 1 }),
    amount: nullablePositive,
    unit: nullableText,
    caloriesKcal: Type.Number({ minimum: 0 }),
    proteinG: nullableNonNegative,
    carbsG: nullableNonNegative,
    fatG: nullableNonNegative,
    fiberG: nullableNonNegative,
    eatenAt: nullableText,
    note: nullableText,
    calorieSourceType: Type.Union([Type.Literal("user_provided"), Type.Literal("nutrition_label"), Type.Literal("local_food_database"), Type.Literal("web_estimate"), Type.Null()]),
    calorieSourceRef: nullableText,
    calorieEstimateLowKcal: nullableNonNegative,
    calorieEstimateHighKcal: nullableNonNegative,
    calorieConfidence: confidence,
    calorieEstimationNote: nullableText,
};

const exerciseFields = {
    exerciseName: Type.String({ minLength: 1 }),
    durationMinutes: Type.Number({ exclusiveMinimum: 0 }),
    caloriesBurnedKcal: Type.Number({ minimum: 0 }),
    intensity: nullableText,
    startedAt: nullableText,
    distanceKm: nullablePositive,
    note: nullableText,
    calorieSourceType: Type.Union([Type.Literal("wearable"), Type.Literal("met_formula"), Type.Literal("user_provided"), Type.Null()]),
    calorieSourceRef: nullableText,
    calorieEstimateLowKcal: nullableNonNegative,
    calorieEstimateHighKcal: nullableNonNegative,
    calorieConfidence: confidence,
    calorieEstimationNote: nullableText,
    metValue: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    reportedCaloriesKcal: nullableNonNegative,
    reportedCalorieBasis: Type.Union([Type.Literal("active"), Type.Literal("total"), Type.Literal("unknown"), Type.Null()]),
};

function result(value: unknown, message?: string) {
    return { content: [{ type: "text" as const, text: message ?? JSON.stringify(value) }], details: value };
}

function requireProfile(repository: ProfileRepository) {
    const profile = repository.get();
    if (!profile) throw new Error("尚未建立减脂画像，请先完成建档。");
    return profile;
}

export function createDailyRecordTools(repository: ProfileRepository, store = new DailyRecordStore(repository.db)) {
    return [
        defineTool({
            name: "get_daily_record", label: "读取每日记录",
            description: "按绝对日期读取当天饮食、运动明细 ID、热量快照和实时汇总。修改、删除或消解同名记录前先调用。",
            parameters: Type.Object({ logDate: Type.String() }, { additionalProperties: false }),
            async execute(_id, { logDate }) { return result(store.getByDate(logDate)); },
        }),
        defineTool({
            name: "list_daily_records", label: "查询每日记录",
            description: "按绝对日期范围读取每日汇总，不返回明细。",
            parameters: Type.Object({ fromDate: Type.String(), toDate: Type.String() }, { additionalProperties: false }),
            async execute(_id, input) { return result(store.list(input.fromDate, input.toDate)); },
        }),
        defineTool({
            name: "add_food_entry", label: "新增饮食记录",
            description: "在信息完整且用户已确认估算值后新增食物明细；当天不存在会自动创建快照。包装/用户明确提供的热量无需估算置信度。相对日期必须先单独获取当前时间。",
            parameters: Type.Object({ logDate: Type.String(), ...foodFields }, { additionalProperties: false }),
            async execute(_id, { logDate, ...input }) { return result(store.addFood(logDate, requireProfile(repository), input as FoodEntryInput)); },
        }),
        defineTool({
            name: "update_food_entry", label: "修改饮食记录",
            description: "修改已通过查询唯一确定的食物明细。估算结果必须先经用户确认。",
            parameters: Type.Object({ id: Type.Integer({ minimum: 1 }), ...Object.fromEntries(Object.entries(foodFields).map(([key, schema]) => [key, Type.Optional(schema)])) }, { additionalProperties: false }),
            async execute(_id, { id, ...changes }) { return result(store.updateFood(id, changes as Partial<FoodEntryInput>)); },
        }),
        defineTool({
            name: "delete_food_entry", label: "删除饮食记录",
            description: "仅在用户明确确认删除后，按查询得到的唯一 ID 删除食物记录。",
            parameters: Type.Object({ id: Type.Integer({ minimum: 1 }), confirmed: Type.Literal(true) }, { additionalProperties: false }),
            async execute(_id, { id }) { const deleted = store.deleteFood(id); if (!deleted) throw new Error("食物记录不存在"); return result({ id, deleted }, "食物记录已删除。"); },
        }),
        defineTool({
            name: "add_exercise_entry", label: "新增运动记录",
            description: "在设备活动热量已明确，或转换/估算值已经用户确认后新增运动明细；运动消耗不会叠加到 TDEE。当天不存在会自动创建快照。",
            parameters: Type.Object({ logDate: Type.String(), ...exerciseFields }, { additionalProperties: false }),
            async execute(_id, { logDate, ...input }) { return result(store.addExercise(logDate, requireProfile(repository), input as ExerciseEntryInput)); },
        }),
        defineTool({
            name: "update_exercise_entry", label: "修改运动记录",
            description: "修改已通过查询唯一确定的运动明细。转换或估算结果必须先经用户确认。",
            parameters: Type.Object({ id: Type.Integer({ minimum: 1 }), ...Object.fromEntries(Object.entries(exerciseFields).map(([key, schema]) => [key, Type.Optional(schema)])) }, { additionalProperties: false }),
            async execute(_id, { id, ...changes }) { return result(store.updateExercise(id, changes as Partial<ExerciseEntryInput>)); },
        }),
        defineTool({
            name: "delete_exercise_entry", label: "删除运动记录",
            description: "仅在用户明确确认删除后，按查询得到的唯一 ID 删除运动记录。",
            parameters: Type.Object({ id: Type.Integer({ minimum: 1 }), confirmed: Type.Literal(true) }, { additionalProperties: false }),
            async execute(_id, { id }) { const deleted = store.deleteExercise(id); if (!deleted) throw new Error("运动记录不存在"); return result({ id, deleted }, "运动记录已删除。"); },
        }),
        defineTool({
            name: "delete_daily_record", label: "删除整日记录",
            description: "仅在用户明确确认删除整日饮食和运动记录后调用，会级联删除当天全部明细。",
            parameters: Type.Object({ logDate: Type.String(), confirmed: Type.Literal(true) }, { additionalProperties: false }),
            async execute(_id, { logDate }) { const deleted = store.deleteDay(logDate); if (!deleted) throw new Error("该日期没有每日记录"); return result({ logDate, deleted }, "该日记录及全部明细已删除。"); },
        }),
    ];
}
