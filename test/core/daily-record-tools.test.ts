import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";

import { ProfileRepository } from "../../src/core/database.ts";
import type { ProfileInput } from "../../src/core/profile.ts";
import { createDailyRecordTools } from "../../src/core/tools/daily-records.ts";

const profile: ProfileInput = {
    gender: "男", age: 30, weightKg: 70, heightCm: 175, bodyFatPct: 25, waistCm: 85, hipCm: null,
    targetBodyFatPct: 20, dailyEnergyDeficitKcal: 500, dietExercisePreference: "吃动平衡派", activityLevel: "中度",
    jobType: "轻体力工作", favoriteExercises: ["步行"], equipment: ["不使用器械"], stairResponse: "几乎没感觉",
    focusArea: "全身", trainingDays: ["一", "三", "五"],
};

test("每日记录工具可完成饮食和运动 CRUD，并由 schema 强制删除确认", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "fatloss-daily-tools-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
    repository.save(profile);
    const tools = new Map(createDailyRecordTools(repository).map((tool) => [tool.name, tool]));
    const call = async (name: string, input: unknown) => {
        const tool = tools.get(name);
        assert.ok(tool);
        return tool.execute("call", input as never, undefined, undefined, {} as never) as Promise<{ details: unknown }>;
    };

    const food = (await call("add_food_entry", {
        logDate: "2026-09-21", mealType: "午餐", foodName: "包装酸奶", amount: 1, unit: "盒", caloriesKcal: 120,
        proteinG: null, carbsG: null, fatG: null, fiberG: null, eatenAt: null, note: null,
        calorieSourceType: "nutrition_label", calorieSourceRef: "包装标签", calorieEstimateLowKcal: null,
        calorieEstimateHighKcal: null, calorieConfidence: null, calorieEstimationNote: null,
    })).details as { id: number };
    const exercise = (await call("add_exercise_entry", {
        logDate: "2026-09-21", exerciseName: "跑步", durationMinutes: 30, caloriesBurnedKcal: 250,
        intensity: "中等", startedAt: null, distanceKm: null, note: null, calorieSourceType: "wearable",
        calorieSourceRef: "运动手表", calorieEstimateLowKcal: null, calorieEstimateHighKcal: null,
        calorieConfidence: null, calorieEstimationNote: null, metValue: null, reportedCaloriesKcal: 250,
        reportedCalorieBasis: "active",
    })).details as { id: number };
    const day = (await call("get_daily_record", { logDate: "2026-09-21" })).details as { foodEntries: unknown[]; exerciseEntries: unknown[] };
    assert.equal(day.foodEntries.length, 1);
    assert.equal(day.exerciseEntries.length, 1);
    assert.equal(((await call("update_food_entry", { id: food.id, caloriesKcal: 125 })).details as { caloriesKcal: number }).caloriesKcal, 125);
    assert.equal(((await call("update_exercise_entry", { id: exercise.id, durationMinutes: 35 })).details as { durationMinutes: number }).durationMinutes, 35);

    const deleteFood = tools.get("delete_food_entry")!;
    assert.equal(Value.Check(deleteFood.parameters, { id: food.id, confirmed: false }), false);
    assert.equal(Value.Check(deleteFood.parameters, { id: food.id, confirmed: true }), true);
    await call("delete_food_entry", { id: food.id, confirmed: true });
    await call("delete_exercise_entry", { id: exercise.id, confirmed: true });
    await call("delete_daily_record", { logDate: "2026-09-21", confirmed: true });
    assert.equal((await call("get_daily_record", { logDate: "2026-09-21" })).details, null);
});

test("新增记录允许省略全部可空字段并统一保存为 null", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "fatloss-daily-minimal-tools-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
    repository.save(profile);
    const tools = new Map(createDailyRecordTools(repository).map((tool) => [tool.name, tool]));
    const foodTool = tools.get("add_food_entry")!;
    const exerciseTool = tools.get("add_exercise_entry")!;
    const foodInput = { logDate: "2026-09-22", mealType: "早餐", foodName: "韭菜鸡蛋包子", caloriesKcal: 260 };
    const exerciseInput = { logDate: "2026-09-22", exerciseName: "快走", durationMinutes: 30, caloriesBurnedKcal: 120 };

    assert.equal(Value.Check(foodTool.parameters, foodInput), true);
    assert.equal(Value.Check(exerciseTool.parameters, exerciseInput), true);
    assert.equal(Value.Check(foodTool.parameters, { ...foodInput, amount: 1 }), true);

    const food = (await foodTool.execute("food", foodInput as never, undefined, undefined, {} as never) as { details: Record<string, unknown> }).details;
    const exercise = (await exerciseTool.execute("exercise", exerciseInput as never, undefined, undefined, {} as never) as { details: Record<string, unknown> }).details;
    assert.equal(food.note, null);
    assert.equal(food.amount, null);
    assert.equal(food.calorieSourceType, null);
    assert.equal(exercise.intensity, null);
    assert.equal(exercise.metValue, null);
    assert.equal(exercise.reportedCalorieBasis, null);

    await assert.rejects(
        () => foodTool.execute("invalid", { ...foodInput, amount: 1 } as never, undefined, undefined, {} as never),
        /食物数量和单位必须同时填写或同时留空/,
    );
    await assert.rejects(
        () => foodTool.execute("invalid", { ...foodInput, unit: "个" } as never, undefined, undefined, {} as never),
        /食物数量和单位必须同时填写或同时留空/,
    );
});
