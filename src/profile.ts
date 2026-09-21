// 问卷选项同时作为运行时校验的白名单，防止命令、旧数据库或后续 UI 写入未知值。
export const GENDERS = ["男", "女"] as const;
export const DIET_EXERCISE_PREFERENCES = ["少吃躺平派", "吃动平衡派", "运动体验派"] as const;
export const ACTIVITY_LEVELS = ["久坐", "轻度", "中度", "高强度"] as const;
// 活动说明、系数由后端统一维护，问卷与计算工具使用同一份配置。
export const ACTIVITY_LEVEL_DETAILS = {
  久坐: { description: "几乎不运动", factor: 1.2 },
  轻度: { description: "每周轻量运动 1～3 天", factor: 1.375 },
  中度: { description: "每周规律运动 3～5 天", factor: 1.55 },
  高强度: { description: "每周规律运动 6～7 天", factor: 1.725 },
} as const;
export const JOB_TYPES = ["轻体力工作", "中体力工作", "重体力工作"] as const;
export const EXERCISES = ["健身课程", "跑步", "步行", "跳绳", "爬楼"] as const;
export const EQUIPMENT = ["哑铃", "弹力带", "不使用器械"] as const;
export const STAIR_RESPONSES = [
  "呼吸局促，甚至有点透不过气",
  "呼吸比较局促",
  "呼吸有点局促，但可以快速恢复",
  "几乎没感觉",
] as const;
export const FOCUS_AREAS = ["全身", "手臂", "胸部", "腹部", "背部", "臀部", "腿部"] as const;
export const TRAINING_DAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export type Gender = (typeof GENDERS)[number];
export type DietExercisePreference = (typeof DIET_EXERCISE_PREFERENCES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type Exercise = (typeof EXERCISES)[number];
export type Equipment = (typeof EQUIPMENT)[number];
export type StairResponse = (typeof STAIR_RESPONSES)[number];
export type FocusArea = (typeof FOCUS_AREAS)[number];
export type TrainingDay = (typeof TRAINING_DAYS)[number];

export interface ProfileInput {
  gender: Gender;
  age: number;
  weightKg: number;
  heightCm: number;
  bodyFatPct: number;
  waistCm: number;
  hipCm: number | null;
  targetBodyFatPct: number;
  dailyEnergyDeficitKcal: number;
  dietExercisePreference: DietExercisePreference;
  activityLevel: ActivityLevel;
  jobType: JobType;
  favoriteExercises: Exercise[];
  equipment: Equipment[];
  stairResponse: StairResponse;
  focusArea: FocusArea;
  trainingDays: TrainingDay[];
}

// 自然语言更新只允许覆盖已建档字段的一部分；更新时间仅由数据库生成。
export type ProfilePatch = Partial<ProfileInput>;

export interface Profile extends Omit<ProfileInput, "activityLevel"> {
  // 仅旧画像可缺失；新建与整份保存必须补选。
  activityLevel: ActivityLevel | null;
  updatedAt: string;
}

export interface FatLossEstimate {
  leanMassKg: number;
  targetWeightKg: number;
  fatLossKg: number;
  estimatedDays: number;
  estimatedWeeks: number;
  speed: "缓慢" | "一般" | "较快";
}

const isOneOf = <T extends readonly string[]>(value: string, options: T): value is T[number] =>
  options.includes(value as T[number]);

function validateNumber(name: string, value: number, minimum: number, maximum: number, integer = false): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${name}需为${minimum}到${maximum}之间${integer ? "的整数" : "的数值"}`);
  }
}

function validateDistinct<T extends string>(name: string, values: T[], maximum: number, minimum: number): void {
  if (values.length < minimum || values.length > maximum || new Set(values).size !== values.length) {
    throw new Error(`${name}选择数量不正确`);
  }
}

export function validateProfile(input: Omit<Profile, "updatedAt">, allowMissingActivityLevel = false): void {
  // UI 校验之外再做一次持久化前校验，确保所有 SQLite 写入都满足问卷规则。
  if ("activityFrequency" in input) throw new Error("运动频次字段已停用，请改用活动水平");
  if ("goal" in input) throw new Error("计划目标字段已移除，当前产品仅用于减脂");
  if (!isOneOf(input.gender, GENDERS)) throw new Error("性别无效");
  validateNumber("年龄", input.age, 18, 100, true);
  validateNumber("体重", input.weightKg, 20, 400);
  validateNumber("身高", input.heightCm, 80, 250);
  validateNumber("体脂率", input.bodyFatPct, 1, 70);
  validateNumber("腰围", input.waistCm, 30, 250);
  if (input.hipCm !== null) validateNumber("臀围", input.hipCm, 30, 250);
  validateNumber("目标脂肪率", input.targetBodyFatPct, 1, input.bodyFatPct);
  validateNumber("每日总能量缺口", input.dailyEnergyDeficitKcal, 300, 1000, true);
  if (!isOneOf(input.dietExercisePreference, DIET_EXERCISE_PREFERENCES)) throw new Error("吃动偏好无效");
  if (!(allowMissingActivityLevel && input.activityLevel === null) && !isOneOf(input.activityLevel ?? "", ACTIVITY_LEVELS)) {
    throw new Error("请选择有效的活动水平：久坐、轻度、中度或高强度");
  }
  if (!isOneOf(input.jobType, JOB_TYPES)) throw new Error("工作类型无效");
  if (!input.favoriteExercises.every((item) => isOneOf(item, EXERCISES))) throw new Error("运动方式无效");
  validateDistinct("运动方式", input.favoriteExercises, 2, 0);
  if (!input.equipment.every((item) => isOneOf(item, EQUIPMENT))) throw new Error("运动器械无效");
  validateDistinct("运动器械", input.equipment, EQUIPMENT.length, 1);
  if (input.equipment.includes("不使用器械") && input.equipment.length > 1) throw new Error("不使用器械不能与其他器械同时选择");
  if (!isOneOf(input.stairResponse, STAIR_RESPONSES)) throw new Error("爬楼反应无效");
  if (!isOneOf(input.focusArea, FOCUS_AREAS)) throw new Error("重点改善部位无效");
  if (!input.trainingDays.every((item) => isOneOf(item, TRAINING_DAYS))) throw new Error("训练日无效");
  validateDistinct("训练日", input.trainingDays, 7, 3);
}

export function getSpeed(dailyEnergyDeficitKcal: number): FatLossEstimate["speed"] {
  if (dailyEnergyDeficitKcal <= 500) return "缓慢";
  if (dailyEnergyDeficitKcal <= 700) return "一般";
  return "较快";
}

export function calculateEstimate(profile: Pick<ProfileInput, "weightKg" | "bodyFatPct" | "targetBodyFatPct" | "dailyEnergyDeficitKcal">): FatLossEstimate {
  validateNumber("体重", profile.weightKg, 20, 400);
  validateNumber("体脂率", profile.bodyFatPct, 1, 70);
  validateNumber("目标脂肪率", profile.targetBodyFatPct, 1, profile.bodyFatPct);
  validateNumber("每日总能量缺口", profile.dailyEnergyDeficitKcal, 300, 1000, true);

  // 静态粗估：假设瘦体重不变，以体脂率反推目标体重；不作为医疗或精确体重变化预测。
  const leanMassKg = profile.weightKg * (1 - profile.bodyFatPct / 100);
  const targetWeightKg = leanMassKg / (1 - profile.targetBodyFatPct / 100);
  const fatLossKg = Math.max(0, profile.weightKg - targetWeightKg);
  const estimatedDays = Math.ceil((fatLossKg * 7700) / profile.dailyEnergyDeficitKcal);

  return {
    leanMassKg,
    targetWeightKg,
    fatLossKg,
    estimatedDays,
    estimatedWeeks: Math.ceil(estimatedDays / 7),
    speed: getSpeed(profile.dailyEnergyDeficitKcal),
  };
}

export function formatProfile(profile: Profile): string {
  // /profile 与 get_current_profile 共用这一格式，避免用户和模型看到不一致的画像摘要。
  const estimate = calculateEstimate(profile);
  const days = estimate.estimatedDays === 0 ? "无需减脂天数估算" : `${estimate.estimatedDays} 天（约 ${estimate.estimatedWeeks} 周）`;
  return [
    "当前减脂画像",
    `性别：${profile.gender}｜年龄：${profile.age} 岁`,
    `身高：${profile.heightCm} cm｜体重：${profile.weightKg} kg｜体脂率：${profile.bodyFatPct}%`,
    `腰围：${profile.waistCm} cm${profile.hipCm === null ? "" : `｜臀围：${profile.hipCm} cm`}`,
    `目标体脂率：${profile.targetBodyFatPct}%`,
    `每日总能量缺口：${profile.dailyEnergyDeficitKcal} 千卡｜速度：${estimate.speed}`,
    `粗略预计：${days}`,
    `吃动偏好：${profile.dietExercisePreference}｜${profile.activityLevel === null ? "活动水平待补充" : `活动水平：${profile.activityLevel}（${ACTIVITY_LEVEL_DETAILS[profile.activityLevel].description}）`}｜工作类型：${profile.jobType}`,
    `喜欢运动：${profile.favoriteExercises.join("、") || "未选择"}｜器械：${profile.equipment.join("、")}`,
    `训练日：${profile.trainingDays.join("、")}｜重点改善：${profile.focusArea}`,
    "说明：该估算采用静态热量换算，不考虑代谢变化、测量误差和实际执行情况，仅供参考。",
  ].join("\n");
}
