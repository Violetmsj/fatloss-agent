import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileNotFoundError, ProfileRepository, ProfileUpdateValidationError } from "../src/database.ts";
import type { ProfileInput } from "../src/profile.ts";
import { createFatlossTools } from "../src/tools/index.ts";
import { createUpdateCurrentProfileTool } from "../src/tools/update-current-profile.ts";

const sampleProfile: ProfileInput = {
  gender: "男",
  age: 26,
  weightKg: 85.5,
  heightCm: 171,
  bodyFatPct: 26.5,
  waistCm: 102,
  hipCm: null,
  goal: "减脂",
  targetBodyFatPct: 20,
  dailyEnergyDeficitKcal: 600,
  dietExercisePreference: "吃动平衡派",
  activityFrequency: "从不锻炼",
  jobType: "中体力工作",
  favoriteExercises: ["步行"],
  equipment: ["不使用器械"],
  stairResponse: "呼吸比较局促",
  focusArea: "全身",
  trainingDays: ["一", "三", "四", "六"],
};

function withRepository(run: (repository: ProfileRepository) => void | Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "fatloss-agent-"));
  const repository = new ProfileRepository(join(directory, "profile.sqlite"));
  return Promise.resolve(run(repository)).finally(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

test("局部更新体重时保留其余画像字段", () => withRepository((repository) => {
  repository.save(sampleProfile);

  const result = repository.update({ weightKg: 79 });
  const stored = repository.get();

  assert.equal(result.before.weightKg, 85.5);
  assert.equal(result.after.weightKg, 79);
  assert.equal(stored?.weightKg, 79);
  assert.equal(stored?.heightCm, sampleProfile.heightCm);
  assert.equal(stored?.bodyFatPct, sampleProfile.bodyFatPct);
  assert.deepEqual(stored?.favoriteExercises, sampleProfile.favoriteExercises);
  assert.deepEqual(stored?.trainingDays, sampleProfile.trainingDays);
  assert.ok(stored?.updatedAt);
}));

test("更新工具会被注册到减脂 Agent 工具列表", () => withRepository((repository) => {
  assert.ok(createFatlossTools(repository).some((tool) => tool.name === "update_current_profile"));
}));

test("增量更新可同时覆盖多个字段及多选字段", () => withRepository((repository) => {
  repository.save(sampleProfile);

  repository.update({
    activityFrequency: "经常锻炼",
    favoriteExercises: ["跑步", "步行"],
    equipment: ["哑铃", "弹力带"],
    trainingDays: ["一", "二", "四"],
  });

  const stored = repository.get();
  assert.equal(stored?.activityFrequency, "经常锻炼");
  assert.deepEqual(stored?.favoriteExercises, ["跑步", "步行"]);
  assert.deepEqual(stored?.equipment, ["哑铃", "弹力带"]);
  assert.deepEqual(stored?.trainingDays, ["一", "二", "四"]);
}));

test("更新拒绝无画像、空补丁和非法或冲突字段，且保留原画像", () => withRepository((repository) => {
  assert.throws(() => repository.update({ weightKg: 79 }), ProfileNotFoundError);

  repository.save(sampleProfile);
  const before = repository.get();
  assert.throws(() => repository.update({}), ProfileUpdateValidationError);
  assert.throws(() => repository.update({ weightKg: 401 }), /体重需为20到400之间的数值/);
  assert.throws(() => repository.update({ bodyFatPct: 20 }), /请先让用户提供不高于 20% 的新目标体脂率/);
  assert.deepEqual(repository.get(), before);
}));

test("更新工具返回字段差异，并把异常转换为可操作提示", async () => withRepository(async (repository) => {
  repository.save(sampleProfile);
  const tool = createUpdateCurrentProfileTool(repository);

  const result = await tool.execute("call-1", { weightKg: 79 }, undefined, undefined, {} as never);
  assert.equal(result.content[0]?.type, "text");
  assert.match(result.content[0]?.text ?? "", /体重（kg）：85.5 → 79/);
  assert.equal(result.details.after.weightKg, 79);

  await assert.rejects(
    () => tool.execute("call-2", { bodyFatPct: 19 }, undefined, undefined, {} as never),
    /请先让用户提供不高于 19% 的新目标体脂率/,
  );
  assert.equal(repository.get()?.bodyFatPct, sampleProfile.bodyFatPct);
}));
