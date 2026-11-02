import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ProfileRepository } from "../../src/core/database.ts";
import { calculateEstimate, getSpeed, type ProfileInput, validateProfile } from "../../src/core/profile.ts";
import { profileFormDefinition } from "../../src/core/profile-form.ts";

const sampleProfile: ProfileInput = {
  gender: "男",
  age: 26,
  weightKg: 85.5,
  heightCm: 171,
  bodyFatPct: 26.5,
  waistCm: 102,
  hipCm: null,
  targetBodyFatPct: 20,
  dailyEnergyDeficitKcal: 600,
  dietExercisePreference: "吃动平衡派",
  activityLevel: "久坐",
  jobType: "中体力工作",
  favoriteExercises: ["步行"],
  equipment: ["不使用器械"],
  stairResponse: "呼吸比较局促",
  focusArea: "全身",
  trainingDays: ["一", "三", "四", "六"],
};

test("估算按透明公式计算，并在 600 千卡时标为一般", () => {
  const estimate = calculateEstimate(sampleProfile);
  assert.equal(estimate.speed, "一般");
  assert.equal(estimate.estimatedDays, Math.ceil((estimate.fatLossKg * 7700) / 600));
  assert.ok(estimate.estimatedDays > 0);
});

test("目标体脂率等于当前体脂率时不需要减脂天数估算", () => {
  const estimate = calculateEstimate({ ...sampleProfile, targetBodyFatPct: sampleProfile.bodyFatPct });
  assert.equal(estimate.fatLossKg, 0);
  assert.equal(estimate.estimatedDays, 0);
  assert.equal(estimate.estimatedWeeks, 0);
});

test("速度标签与每日能量缺口边界一致", () => {
  assert.equal(getSpeed(300), "缓慢");
  assert.equal(getSpeed(500), "缓慢");
  assert.equal(getSpeed(501), "一般");
  assert.equal(getSpeed(700), "一般");
  assert.equal(getSpeed(701), "较快");
  assert.equal(getSpeed(1000), "较快");
});

test("画像校验拒绝非法训练日、过多运动方式和越界能量缺口", () => {
  assert.throws(() => validateProfile({ ...sampleProfile, trainingDays: ["一", "二"] }));
  assert.throws(() => validateProfile({ ...sampleProfile, favoriteExercises: ["健身课程", "跑步", "步行"] }));
  assert.throws(() => validateProfile({ ...sampleProfile, dailyEnergyDeficitKcal: 1001 }));
});

test("SQLite 只保留一个画像，并支持空或填写臀围", () => {
  const directory = mkdtempSync(join(tmpdir(), "fatloss-agent-"));
  const repository = new ProfileRepository(join(directory, "profile.sqlite"));
  try {
    assert.equal(repository.get(), null);
    repository.save(sampleProfile);
    assert.equal(repository.get()?.hipCm, null);
    repository.save({ ...sampleProfile, weightKg: 80, hipCm: 98 });
    const stored = repository.get();
    assert.equal(stored?.weightKg, 80);
    assert.equal(stored?.hipCm, 98);
    assert.deepEqual(stored?.trainingDays, ["一", "三", "四", "六"]);
    const columns = repository.db.prepare("PRAGMA table_info(profile)").all().map((column) => column.name);
    assert.equal(columns.includes("goal"), false);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("当前版画像移除目标字段时保留画像和每日记录", () => {
  const directory = mkdtempSync(join(tmpdir(), "fatloss-goal-migration-"));
  const path = join(directory, "profile.sqlite");
  const original = new ProfileRepository(path);
  const stored = original.save(sampleProfile);
  original.db.prepare(`
    INSERT INTO daily_records (
      log_date, bmr_kcal_snapshot, tdee_kcal_snapshot, intake_target_kcal_snapshot, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-09-21", 1700, 2200, 1600, stored.updatedAt, stored.updatedAt);
  original.close();

  const legacy = new DatabaseSync(path);
  legacy.exec("ALTER TABLE profile ADD COLUMN goal TEXT NOT NULL DEFAULT '保持体型'");
  legacy.close();

  const migrated = new ProfileRepository(path);
  try {
    assert.deepEqual(migrated.get(), stored);
    const columns = migrated.db.prepare("PRAGMA table_info(profile)").all().map((column) => column.name);
    assert.equal(columns.includes("goal"), false);
    assert.equal(migrated.db.prepare("SELECT bmr_kcal_snapshot FROM daily_records WHERE log_date = ?").get("2026-09-21")?.bmr_kcal_snapshot, 1700);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("建档表单活动选项使用业务枚举和固定系数", () => {
  assert.deepEqual(profileFormDefinition.options.activityLevels.map(item => item.value), ["久坐", "轻度", "中度", "高强度"]);
  assert.deepEqual(profileFormDefinition.options.activityLevels.map(item => item.factor), [1.2, 1.375, 1.55, 1.725]);
  for (const { value } of profileFormDefinition.options.activityLevels) {
    assert.doesNotThrow(() => validateProfile({ ...sampleProfile, activityLevel: value }));
  }
});
