import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DailyRecordStore, type ExerciseEntryInput, type FoodEntryInput } from "../src/daily-record-store.ts";
import { ProfileRepository } from "../src/database.ts";
import { calculateEnergyNeeds } from "../src/energy-calculation.ts";
import { MemoryStore } from "../src/memory-store.ts";
import type { Profile, ProfileInput } from "../src/profile.ts";

const profileInput: ProfileInput = {
    gender: "男",
    age: 30,
    weightKg: 70,
    heightCm: 175,
    bodyFatPct: 25,
    waistCm: 85,
    hipCm: null,
    targetBodyFatPct: 20,
    dailyEnergyDeficitKcal: 500,
    dietExercisePreference: "吃动平衡派",
    activityLevel: "中度",
    jobType: "轻体力工作",
    favoriteExercises: ["步行"],
    equipment: ["不使用器械"],
    stairResponse: "几乎没感觉",
    focusArea: "全身",
    trainingDays: ["一", "三", "五"],
};

const breakfast: FoodEntryInput = {
    mealType: "早餐",
    foodName: " 水煮蛋 ",
    amount: 2,
    unit: "个",
    caloriesKcal: 140,
    proteinG: 12.6,
    carbsG: 1.2,
    fatG: 9.5,
    fiberG: null,
    eatenAt: "2026-09-21T08:00:00+08:00",
    note: " 少盐 ",
};

const running: ExerciseEntryInput = {
    exerciseName: " 跑步 ",
    durationMinutes: 30,
    caloriesBurnedKcal: 260.5,
    intensity: " 中等 ",
    startedAt: "2026-09-21T18:30:00+08:00",
    distanceKm: 5,
    note: null,
};

function withStore(run: (repository: ProfileRepository, store: DailyRecordStore, profile: Profile) => void): void {
    const directory = mkdtempSync(join(tmpdir(), "fatloss-daily-record-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    let now = Date.parse("2026-09-21T00:00:00.000Z");
    const store = new DailyRecordStore(repository.db, () => now++);
    try {
        const profile = repository.save(profileInput);
        run(repository, store, profile);
    } finally {
        repository.close();
        rmSync(directory, { recursive: true, force: true });
    }
}

test("每日记录三张表可重复初始化，且不影响已有画像和记忆", () => withStore((repository, store, profile) => {
    const memories = new MemoryStore(repository.db, () => Date.parse("2026-09-21T00:00:00.000Z"));
    const enabledAt = memories.enabledAt;
    new DailyRecordStore(repository.db);

    const tables = repository.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('daily_records', 'food_entries', 'exercise_entries')
        ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(tables, ["daily_records", "exercise_entries", "food_entries"]);
    assert.equal(repository.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.deepEqual(repository.get(), profile);
    assert.equal(memories.enabledAt, enabledAt);
    assert.equal(store.getByDate("2026-09-21"), null);
}));

test("每日热量快照首次创建后不随画像修改，并支持日期范围汇总", () => withStore((repository, store, profile) => {
    const expected = calculateEnergyNeeds(profile);
    const created = store.getOrCreate("2026-09-21", profile);
    assert.equal(created.bmrKcalSnapshot, expected.bmrKcal);
    assert.equal(created.tdeeKcalSnapshot, expected.tdeeKcal);
    assert.equal(created.intakeTargetKcalSnapshot, expected.intakeKcal);

    const changed = repository.update({ weightKg: 80, dailyEnergyDeficitKcal: 300 }).after;
    assert.notEqual(calculateEnergyNeeds(changed).bmrKcal, created.bmrKcalSnapshot);
    assert.deepEqual(store.getOrCreate("2026-09-21", changed), created);
    assert.deepEqual(store.list("2026-09-21", "2026-09-21")[0], {
        ...created,
        mealIntakeKcal: { 早餐: 0, 午餐: 0, 晚餐: 0, 加餐: 0 },
        totalIntakeKcal: 0,
        totalExerciseKcal: 0,
    });
    assert.throws(() => store.list("2026-09-22", "2026-09-21"), /开始日期/);
}));

test("旧画像缺少活动水平时只保存基础代谢快照", () => withStore((_repository, store, profile) => {
    const legacyProfile: Profile = { ...profile, activityLevel: null };
    const day = store.getOrCreate("2026-09-20", legacyProfile);
    assert.equal(day.bmrKcalSnapshot, calculateEnergyNeeds(legacyProfile).bmrKcal);
    assert.equal(day.tdeeKcalSnapshot, null);
    assert.equal(day.intakeTargetKcalSnapshot, null);
}));

test("食物明细按餐次汇总，并支持修改和删除", () => withStore((_repository, store, profile) => {
    const egg = store.addFood("2026-09-21", profile, breakfast);
    assert.equal(egg.foodName, "水煮蛋");
    assert.equal(egg.note, "少盐");
    assert.equal(egg.proteinG, 12.6);
    const rice = store.addFood("2026-09-21", profile, {
        ...breakfast,
        mealType: "午餐",
        foodName: "米饭",
        amount: 200,
        unit: "克",
        caloriesKcal: 232.5,
        proteinG: null,
        carbsG: null,
        fatG: null,
        eatenAt: null,
        note: null,
    });

    let details = store.getByDate("2026-09-21")!;
    assert.deepEqual(details.summary.mealIntakeKcal, { 早餐: 140, 午餐: 232.5, 晚餐: 0, 加餐: 0 });
    assert.equal(details.summary.totalIntakeKcal, 372.5);
    assert.equal(details.foodEntries.length, 2);

    const updated = store.updateFood(rice.id, { mealType: "晚餐", caloriesKcal: 250 });
    assert.equal(updated.mealType, "晚餐");
    assert.equal(updated.caloriesKcal, 250);
    assert.equal(store.deleteFood(egg.id), true);
    assert.equal(store.deleteFood(egg.id), false);
    details = store.getByDate("2026-09-21")!;
    assert.deepEqual(details.summary.mealIntakeKcal, { 早餐: 0, 午餐: 0, 晚餐: 250, 加餐: 0 });
    assert.equal(details.summary.totalIntakeKcal, 250);
}));

test("运动明细单独汇总，不改变每日总消耗和摄入快照", () => withStore((_repository, store, profile) => {
    const day = store.getOrCreate("2026-09-21", profile);
    const run = store.addExercise("2026-09-21", profile, running);
    const walk = store.addExercise("2026-09-21", profile, {
        ...running,
        exerciseName: "步行",
        durationMinutes: 40,
        caloriesBurnedKcal: 120,
        intensity: null,
        startedAt: null,
        distanceKm: null,
    });
    let details = store.getByDate("2026-09-21")!;
    assert.equal(details.summary.totalExerciseKcal, 380.5);
    assert.equal(details.summary.tdeeKcalSnapshot, day.tdeeKcalSnapshot);
    assert.equal(details.summary.intakeTargetKcalSnapshot, day.intakeTargetKcalSnapshot);

    const updated = store.updateExercise(run.id, { durationMinutes: 35, caloriesBurnedKcal: 300 });
    assert.equal(updated.exerciseName, "跑步");
    assert.equal(updated.intensity, "中等");
    assert.equal(store.deleteExercise(walk.id), true);
    assert.equal(store.deleteExercise(walk.id), false);
    details = store.getByDate("2026-09-21")!;
    assert.equal(details.summary.totalExerciseKcal, 300);
}));

test("食物与运动来源、估算区间和设备原始值可持久化并严格校验", () => withStore((_repository, store, profile) => {
    const food = store.addFood("2026-09-21", profile, {
        ...breakfast,
        caloriesKcal: 150,
        calorieSourceType: "web_estimate",
        calorieSourceRef: "https://example.test/food",
        calorieEstimateLowKcal: 120,
        calorieEstimateHighKcal: 180,
        calorieConfidence: "medium",
        calorieEstimationNote: "按一份估算",
    });
    assert.equal(food.calorieConfidence, "medium");
    assert.equal(food.calorieEstimateHighKcal, 180);
    const exercise = store.addExercise("2026-09-21", profile, {
        ...running,
        caloriesBurnedKcal: 230,
        calorieSourceType: "wearable",
        calorieSourceRef: "Apple Watch",
        calorieConfidence: "medium",
        calorieEstimationNote: "总热量减静息消耗",
        metValue: null,
        reportedCaloriesKcal: 300,
        reportedCalorieBasis: "total",
    });
    assert.equal(exercise.reportedCaloriesKcal, 300);
    assert.equal(exercise.reportedCalorieBasis, "total");
    assert.throws(() => store.addFood("2026-09-22", profile, {
        ...breakfast,
        caloriesKcal: 100,
        calorieEstimateLowKcal: 120,
        calorieEstimateHighKcal: 150,
    }), /下界/);
    assert.equal(store.getByDate("2026-09-22"), null);
}));

test("删除每日记录级联删除明细，非法输入不创建半条每日记录", () => withStore((repository, store, profile) => {
    assert.throws(() => store.addFood("2026-09-22", profile, { ...breakfast, amount: 1, unit: null }), /数量和单位/);
    assert.equal(store.getByDate("2026-09-22"), null);
    assert.throws(() => store.addExercise("2026-02-30", profile, running), /有效日历日期/);
    assert.throws(() => store.addExercise("2026-09-22", profile, { ...running, durationMinutes: 0 }), /运动时长/);
    assert.equal(store.getByDate("2026-09-22"), null);
    assert.throws(() => store.updateFood(999, { caloriesKcal: 1 }), /不存在/);
    assert.throws(() => store.updateExercise(999, { durationMinutes: 1 }), /不存在/);

    store.addFood("2026-09-21", profile, breakfast);
    store.addExercise("2026-09-21", profile, running);
    assert.equal(store.deleteDay("2026-09-21"), true);
    assert.equal(store.deleteDay("2026-09-21"), false);
    assert.equal(repository.db.prepare("SELECT count(*) AS count FROM food_entries").get()?.count, 0);
    assert.equal(repository.db.prepare("SELECT count(*) AS count FROM exercise_entries").get()?.count, 0);
}));
