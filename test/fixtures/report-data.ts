import type { ProfileInput } from "../../src/core/profile.ts";
import type { FoodEntryInput, ExerciseEntryInput } from "../../src/core/daily-record.ts";

export const reportProfile: ProfileInput = {
    gender: "男", age: 30, weightKg: 70, heightCm: 175, bodyFatPct: 25, waistCm: 85, hipCm: null,
    targetBodyFatPct: 20, dailyEnergyDeficitKcal: 300, dietExercisePreference: "吃动平衡派", activityLevel: "轻度",
    jobType: "轻体力工作", favoriteExercises: ["步行"], equipment: ["不使用器械"], stairResponse: "几乎没感觉",
    focusArea: "全身", trainingDays: ["一", "三", "五"],
};

export const reportFood: FoodEntryInput = {
    mealType: "早餐", foodName: "燕麦", amount: 50, unit: "克", caloriesKcal: 190,
    proteinG: 7, carbsG: 30, fatG: 3, fiberG: null, eatenAt: null, note: null,
};

export const reportExercise: ExerciseEntryInput = {
    exerciseName: "步行", durationMinutes: 30, caloriesBurnedKcal: 100,
    distanceKm: 2, intensity: null, startedAt: null, note: null,
};

export const reportSummary = {
    overview: "这份报告记录了饮食和运动情况。",
    observations: ["饮食和运动的记录覆盖不同。"], limitations: ["已记录摄入不代表完整摄入。"], nextSteps: ["继续按实际情况记录。"],
};
