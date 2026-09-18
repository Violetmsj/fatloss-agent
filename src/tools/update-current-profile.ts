import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ProfileNotFoundError, ProfileRepository, ProfileStorageError, ProfileUpdateValidationError } from "../database.ts";
import { ACTIVITY_FREQUENCIES, DIET_EXERCISE_PREFERENCES, EQUIPMENT, EXERCISES, FOCUS_AREAS, GENDERS, GOALS, JOB_TYPES, STAIR_RESPONSES, TRAINING_DAYS, type ProfileInput } from "../profile.ts";

const literals = <T extends readonly string[]>(values: T) => Type.Union(values.map((value) => Type.Literal(value)));

const fieldLabels: Record<keyof ProfileInput, string> = {
  gender: "性别",
  age: "年龄",
  weightKg: "体重（kg）",
  heightCm: "身高（cm）",
  bodyFatPct: "当前体脂率（%）",
  waistCm: "腰围（cm）",
  hipCm: "臀围（cm）",
  goal: "计划目标",
  targetBodyFatPct: "目标体脂率（%）",
  dailyEnergyDeficitKcal: "每日总能量缺口（千卡）",
  dietExercisePreference: "吃动偏好",
  activityFrequency: "运动频次",
  jobType: "工作类型",
  favoriteExercises: "喜欢运动",
  equipment: "器械",
  stairResponse: "爬楼反应",
  focusArea: "重点改善部位",
  trainingDays: "训练日",
};

function formatValue(value: ProfileInput[keyof ProfileInput]): string {
  if (value === null) return "未填写";
  return Array.isArray(value) ? value.join("、") : String(value);
}

/**
 * 创建模型可调用的画像增量更新工具。
 * 调用前由系统提示词保证已展示差异并获得用户确认；工具只负责确定性校验和原子写入。
 */
export function createUpdateCurrentProfileTool(repository: ProfileRepository) {
  return defineTool({
    name: "update_current_profile",
    label: "更新当前减脂画像",
    description: "在用户已确认展示出的变更后，局部更新当前减脂画像。仅传需要修改的字段，不能传 updatedAt。调用前必须先读取当前画像、展示所有字段的前后差异并得到明确确认。",
    parameters: Type.Object({
      gender: Type.Optional(literals(GENDERS)),
      age: Type.Optional(Type.Integer({ minimum: 18, maximum: 100 })),
      weightKg: Type.Optional(Type.Number({ minimum: 20, maximum: 400 })),
      heightCm: Type.Optional(Type.Number({ minimum: 80, maximum: 250 })),
      bodyFatPct: Type.Optional(Type.Number({ minimum: 1, maximum: 70 })),
      waistCm: Type.Optional(Type.Number({ minimum: 30, maximum: 250 })),
      hipCm: Type.Optional(Type.Union([Type.Number({ minimum: 30, maximum: 250 }), Type.Null()])),
      goal: Type.Optional(literals(GOALS)),
      targetBodyFatPct: Type.Optional(Type.Number({ minimum: 1, maximum: 70 })),
      dailyEnergyDeficitKcal: Type.Optional(Type.Integer({ minimum: 300, maximum: 1000 })),
      dietExercisePreference: Type.Optional(literals(DIET_EXERCISE_PREFERENCES)),
      activityFrequency: Type.Optional(literals(ACTIVITY_FREQUENCIES)),
      jobType: Type.Optional(literals(JOB_TYPES)),
      favoriteExercises: Type.Optional(Type.Array(literals(EXERCISES), { minItems: 0, maxItems: 2 })),
      equipment: Type.Optional(Type.Array(literals(EQUIPMENT), { minItems: 1, maxItems: EQUIPMENT.length })),
      stairResponse: Type.Optional(literals(STAIR_RESPONSES)),
      focusArea: Type.Optional(literals(FOCUS_AREAS)),
      trainingDays: Type.Optional(Type.Array(literals(TRAINING_DAYS), { minItems: 3, maxItems: 7 })),
    }, { additionalProperties: false, minProperties: 1 }),
    async execute(_toolCallId, changes) {
      try {
        const result = repository.update(changes);
        const summary = (Object.keys(changes) as (keyof ProfileInput)[])
          .map((field) => `${fieldLabels[field]}：${formatValue(result.before[field])} → ${formatValue(result.after[field])}`)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: `减脂画像已更新：\n${summary}` }],
          details: result,
        };
      } catch (error) {
        if (error instanceof ProfileNotFoundError) {
          throw new Error("尚未建立减脂画像，无法更新。请提示用户先输入 /onboard 完成建档。");
        }
        if (error instanceof ProfileUpdateValidationError) throw new Error(error.message, { cause: error });
        if (error instanceof ProfileStorageError) {
          throw new Error("减脂画像暂时未能保存，请告知用户数据没有变更并建议稍后重试。", { cause: error });
        }
        throw error;
      }
    },
  });
}
