import { describe, expect, it } from "vitest";

import type { ProfileFormDefinition, ProfileInput } from "./api";
import { validateProfileForm } from "./profile-validation";

const definition: ProfileFormDefinition = {
    options: {
        genders: ["男", "女"], goals: ["减脂"], dietExercisePreferences: ["吃动平衡派"], activityLevels: [{ value: "轻度", description: "每周轻量运动 1～3 天", factor: 1.375 }],
        jobTypes: ["轻体力工作"], exercises: ["步行", "跑步"], equipment: ["哑铃", "不使用器械"], stairResponses: ["几乎没感觉"], focusAreas: ["全身"], trainingDays: ["一", "二", "三", "四", "五", "六", "日"],
    },
    constraints: {
        age: { minimum: 18, maximum: 100, integer: true }, weightKg: { minimum: 20, maximum: 400 }, heightCm: { minimum: 80, maximum: 250 }, bodyFatPct: { minimum: 1, maximum: 70 }, waistCm: { minimum: 30, maximum: 250 }, hipCm: { minimum: 30, maximum: 250, optional: true }, targetBodyFatPct: { minimum: 1, maximumField: "bodyFatPct" }, dailyEnergyDeficitKcal: { minimum: 300, maximum: 1000, integer: true }, favoriteExercises: { minimum: 0, maximum: 2 }, equipment: { minimum: 1, maximum: 2, exclusive: "不使用器械" }, trainingDays: { minimum: 3, maximum: 7 },
    },
};
const profile: ProfileInput = {
    gender: "男", age: 30, weightKg: 80, heightCm: 178, bodyFatPct: 25, waistCm: 90, hipCm: null,
    goal: "减脂", targetBodyFatPct: 18, dailyEnergyDeficitKcal: 500, dietExercisePreference: "吃动平衡派", activityLevel: "轻度", jobType: "轻体力工作", favoriteExercises: ["步行"], equipment: ["哑铃"], stairResponse: "几乎没感觉", focusArea: "全身", trainingDays: ["一", "三", "五"],
};

describe("画像表单校验", () => {
    it("接受完整合法画像", () => expect(validateProfileForm(profile, definition)).toEqual({}));
    it("活动水平必须补选且拒绝旧运动频次值", () => {
        expect(validateProfileForm({ ...profile, activityLevel: "" }, definition).activityLevel).toBeTruthy();
        expect(validateProfileForm({ ...profile, activityLevel: "偶尔锻炼" }, definition).activityLevel).toBeTruthy();
    });
    it("拒绝越界目标、过多运动、器械互斥和训练日不足", () => {
        const errors = validateProfileForm({ ...profile, targetBodyFatPct: 30, favoriteExercises: ["步行", "跑步", "跳绳"], equipment: ["哑铃", "不使用器械"], trainingDays: ["一", "二"] }, definition);
        expect(errors.targetBodyFatPct).toBeTruthy();
        expect(errors.favoriteExercises).toBeTruthy();
        expect(errors.equipment).toBeTruthy();
        expect(errors.trainingDays).toBeTruthy();
    });
});
