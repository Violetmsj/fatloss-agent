import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Profile, type ProfileInput, type TrainingDay, ACTIVITY_FREQUENCIES, DIET_EXERCISE_PREFERENCES, EQUIPMENT, EXERCISES, FOCUS_AREAS, GENDERS, GOALS, JOB_TYPES, STAIR_RESPONSES, TRAINING_DAYS, formatProfile } from "./profile.ts";

const TOTAL_STEPS = 12;
// 仅用于 TUI 展示；入库仍保存简洁的“轻/中/重体力工作”枚举值，避免把说明文案混入画像数据。
const JOB_TYPE_EXAMPLES: Record<(typeof JOB_TYPES)[number], string> = {
  轻体力工作: "如办公室职员、售货员、简单家务等工作",
  中体力工作: "如学生、司机、外科医生、体育教师等工作",
  重体力工作: "如建筑工、搬运工、冶炼工等工作",
};

function title(step: number, question: string): string {
  return `减脂建档 · ${step}/${TOTAL_STEPS}\n${question}`;
}

async function choose<T extends string>(ctx: ExtensionContext, step: number, question: string, options: readonly T[]): Promise<T | null> {
  const value = await ctx.ui.select(title(step, question), [...options]);
  // pi 的对话框被取消时返回 undefined；问卷统一转换成 null 以终止整次建档且不写数据库。
  return value === undefined ? null : (value as T);
}

async function chooseJobType(ctx: ExtensionContext) {
  const labels = JOB_TYPES.map((jobType) => `${jobType}（${JOB_TYPE_EXAMPLES[jobType]}）`);
  const selectedLabel = await ctx.ui.select(title(8, "您目前从事的工作类型是？"), labels);
  const index = selectedLabel === undefined ? -1 : labels.indexOf(selectedLabel);
  return index === -1 ? null : JOB_TYPES[index];
}

async function chooseYesNo(ctx: ExtensionContext, step: number, question: string, message: string): Promise<boolean | null> {
  const answer = await ctx.ui.select(`${title(step, question)}\n${message}`, ["是", "否"]);
  if (answer === undefined) return null;
  return answer === "是";
}

async function readNumber(
  ctx: ExtensionContext,
  step: number,
  question: string,
  placeholder: string,
  minimum: number,
  maximum: number,
  integer = false,
  optional = false,
): Promise<number | null | undefined> {
  while (true) {
    const value = await ctx.ui.input(title(step, question), placeholder);
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (optional && trimmed === "") return null;
    // 单位已经在标题和示例中说明，存储层只接受裸数值，避免将 "83kg" 这类显示文本写入画像。
    const numericValue = Number(trimmed);
    if (Number.isFinite(numericValue) && numericValue >= minimum && numericValue <= maximum && (!integer || Number.isInteger(numericValue))) {
      return numericValue;
    }
    ctx.ui.notify(`请输入 ${minimum} 到 ${maximum} 之间${integer ? "的整数" : "的数值"}。${optional ? "留空可跳过。" : ""}`, "warning");
  }
}

async function chooseMultiple<T extends string>(
  ctx: ExtensionContext,
  step: number,
  question: string,
  choices: readonly T[],
  minimum: number,
  maximum: number,
  exclusiveChoice?: T,
): Promise<T[] | null> {
  const selected: T[] = [];

  // “喜欢的运动方式”允许不选；其余多选题必须至少选中 minimum 项。
  if (minimum === 0) {
    const shouldSelect = await chooseYesNo(ctx, step, question, "是否选择一项运动方式？");
    if (shouldSelect === null) return null;
    if (!shouldSelect) return selected;
  }

  while (true) {
    const remaining = choices.filter((item) => !selected.includes(item) && (selected.length === 0 || item !== exclusiveChoice));
    // 不把“完成选择”伪装成业务选项：选中后再以确认框询问是否继续添加。
    const answer = await ctx.ui.select(`${title(step, question)}\n已选：${selected.join("、") || "暂无"}`, [...remaining]);
    if (answer === undefined) return null;
    selected.push(answer as T);
    // “不使用器械”与任一器械互斥，选中后立即完成，避免出现矛盾的画像数据。
    if (answer === exclusiveChoice) return selected;
    if (selected.length === maximum || remaining.length === 1) return selected;

    if (selected.length < minimum) {
      ctx.ui.notify(`已选择 ${selected.length} 项，请至少选择 ${minimum} 项。`, "info");
      continue;
    }

    const shouldContinue = await chooseYesNo(ctx, step, question, `已选择：${selected.join("、")}\n是否继续添加？`);
    if (shouldContinue === null) return null;
    if (!shouldContinue) return selected;
  }
}

async function collectProfile(ctx: ExtensionContext): Promise<ProfileInput | null> {
  // 问卷全程只在内存中组装 ProfileInput；最终确认前取消不会覆盖已有画像。
  while (true) {
    const gender = await choose(ctx, 1, "请选择性别", GENDERS);
    if (!gender) return null;
    const age = await readNumber(ctx, 1, "请输入年龄", "18-100 岁", 18, 100, true);
    if (age === undefined || age === null) return null;
    const weightKg = await readNumber(ctx, 2, "请输入当前体重（单位：kg）", "例如：83（只输入数字）", 20, 400);
    if (weightKg === undefined || weightKg === null) return null;
    const heightCm = await readNumber(ctx, 2, "请输入身高（单位：cm）", "例如：171（只输入数字）", 80, 250);
    if (heightCm === undefined || heightCm === null) return null;
    const bodyFatPct = await readNumber(ctx, 2, "请输入当前体脂率（单位：%）", "例如：26.5（只输入数字）", 1, 70);
    if (bodyFatPct === undefined || bodyFatPct === null) return null;
    const waistCm = await readNumber(ctx, 2, "请输入腰围（单位：cm）", "例如：102（只输入数字）", 30, 250);
    if (waistCm === undefined || waistCm === null) return null;
    const hipCm = await readNumber(ctx, 2, "请输入臀围（单位：cm，可留空）", "例如：98（只输入数字）", 30, 250, false, true);
    if (hipCm === undefined) return null;

    const confirmed = await ctx.ui.confirm(
      title(2, "请确认个人信息"),
      `性别：${gender}\n年龄：${age} 岁\n身高：${heightCm} cm\n体重：${weightKg} kg\n体脂率：${bodyFatPct}%\n腰围：${waistCm} cm${hipCm === null ? "" : `\n臀围：${hipCm} cm`}`,
    );
    if (confirmed) {
      const goal = await choose(ctx, 3, "您的计划目标是？", GOALS);
      if (!goal) return null;
      const targetBodyFatPct = await readNumber(ctx, 4, "请设置目标脂肪率", `1-${bodyFatPct}%`, 1, bodyFatPct);
      if (targetBodyFatPct === undefined || targetBodyFatPct === null) return null;
      const dailyEnergyDeficitKcal = await readNumber(ctx, 5, "请输入每日总能量缺口", "300-1000 千卡", 300, 1000, true);
      if (dailyEnergyDeficitKcal === undefined || dailyEnergyDeficitKcal === null) return null;
      const dietExercisePreference = await choose(ctx, 6, "您希望的运动饮食比例是？", DIET_EXERCISE_PREFERENCES);
      if (!dietExercisePreference) return null;
      const activityFrequency = await choose(ctx, 7, "您当前的运动频次是？", ACTIVITY_FREQUENCIES);
      if (!activityFrequency) return null;
      const jobType = await chooseJobType(ctx);
      if (!jobType) return null;
      const favoriteExercises = await chooseMultiple(ctx, 9, "您喜欢以哪种方式运动？（最多 2 种）", EXERCISES, 0, 2);
      if (!favoriteExercises) return null;
      const equipment = await chooseMultiple(ctx, 10, "您希望在计划中使用哪些运动器械？", EQUIPMENT, 1, EQUIPMENT.length, "不使用器械");
      if (!equipment) return null;
      const stairResponse = await choose(ctx, 11, "连续上五层楼后，是否会感觉呼吸局促？", STAIR_RESPONSES);
      if (!stairResponse) return null;
      const focusArea = await choose(ctx, 11, "您希望重点改善哪些部位？", FOCUS_AREAS);
      if (!focusArea) return null;
      const trainingDays = await chooseMultiple(ctx, 12, "您每周的训练时间是？（请选择 3-7 天）", TRAINING_DAYS, 3, 7);
      if (!trainingDays) return null;

      return {
        gender,
        age,
        weightKg,
        heightCm,
        bodyFatPct,
        waistCm,
        hipCm,
        goal,
        targetBodyFatPct,
        dailyEnergyDeficitKcal,
        dietExercisePreference,
        activityFrequency,
        jobType,
        favoriteExercises,
        equipment,
        stairResponse,
        focusArea,
        trainingDays: trainingDays as TrainingDay[],
      };
    }
  }
}

export async function runOnboarding(ctx: ExtensionContext, save: (profile: ProfileInput) => Profile): Promise<Profile | null> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("减脂建档只能在交互式 TUI 中运行。", "warning");
    return null;
  }
  const profile = await collectProfile(ctx);
  if (!profile) {
    ctx.ui.notify("已取消建档，当前画像没有变更。", "info");
    return null;
  }

  // 预览使用临时时间戳，只在用户最终确认后才调用 save() 写入 SQLite。
  const preview: Profile = { ...profile, updatedAt: new Date().toISOString() };
  const confirmed = await ctx.ui.confirm(
    "确认保存减脂画像",
    `${formatProfile(preview)}\n\n确认后将覆盖当前唯一画像。`,
  );
  if (!confirmed) {
    ctx.ui.notify("已取消建档，当前画像没有变更。", "info");
    return null;
  }
  return save(profile);
}
