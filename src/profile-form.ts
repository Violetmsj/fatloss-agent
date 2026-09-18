import {
  ACTIVITY_FREQUENCIES,
  DIET_EXERCISE_PREFERENCES,
  EQUIPMENT,
  EXERCISES,
  FOCUS_AREAS,
  GENDERS,
  GOALS,
  JOB_TYPES,
  STAIR_RESPONSES,
  TRAINING_DAYS,
} from "./profile.ts";

/**
 * 后端下发给 Web 表单的唯一选项与边界来源。
 * 真正写库前仍会调用 validateProfile，前端不能依赖这份描述绕过服务端校验。
 */
export const profileFormDefinition = {
  options: {
    genders: GENDERS,
    goals: GOALS,
    dietExercisePreferences: DIET_EXERCISE_PREFERENCES,
    activityFrequencies: ACTIVITY_FREQUENCIES,
    jobTypes: JOB_TYPES,
    exercises: EXERCISES,
    equipment: EQUIPMENT,
    stairResponses: STAIR_RESPONSES,
    focusAreas: FOCUS_AREAS,
    trainingDays: TRAINING_DAYS,
  },
  constraints: {
    age: { minimum: 18, maximum: 100, integer: true },
    weightKg: { minimum: 20, maximum: 400 },
    heightCm: { minimum: 80, maximum: 250 },
    bodyFatPct: { minimum: 1, maximum: 70 },
    waistCm: { minimum: 30, maximum: 250 },
    hipCm: { minimum: 30, maximum: 250, optional: true },
    targetBodyFatPct: { minimum: 1, maximumField: "bodyFatPct" },
    dailyEnergyDeficitKcal: { minimum: 300, maximum: 1000, integer: true },
    favoriteExercises: { minimum: 0, maximum: 2 },
    equipment: { minimum: 1, maximum: EQUIPMENT.length, exclusive: "不使用器械" },
    trainingDays: { minimum: 3, maximum: 7 },
  },
} as const;
