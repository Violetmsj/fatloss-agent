import { ACTIVITY_LEVEL_DETAILS, type Profile, validateProfile } from "./profile.ts";

type EnergyProfile = Omit<Profile, "updatedAt">;

export interface EnergyCalculation {
    formula: string;
    unit: string;
    input: Pick<EnergyProfile, "gender" | "age" | "heightCm" | "weightKg" | "activityLevel" | "goal" | "dailyEnergyDeficitKcal">;
    activityFactor: number | null;
    appliedDeficitKcal: number;
    bmrKcal: number;
    tdeeKcal: number | null;
    intakeKcal: number | null;
    notes: string[];
}

/** Mifflin–St Jeor 静息能量估算：https://pubmed.ncbi.nlm.nih.gov/2305711/ */
export function calculateEnergyNeeds(profile: EnergyProfile): EnergyCalculation {
    validateProfile(profile, true);
    const { gender, age, heightCm, weightKg, activityLevel, goal, dailyEnergyDeficitKcal } = profile;
    const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === "男" ? 5 : -161);
    if (bmr <= 0) throw new Error("基础代谢估算为非正数，请核实画像中的性别、年龄、身高和体重。");

    const activityFactor = activityLevel === null ? null : ACTIVITY_LEVEL_DETAILS[activityLevel].factor;
    const tdee = activityFactor === null ? null : bmr * activityFactor;
    if (tdee !== null && tdee <= 0) throw new Error("每日总消耗估算为非正数，请核实画像。");
    const appliedDeficitKcal = goal === "保持体型" ? 0 : dailyEnergyDeficitKcal;
    const intake = tdee === null ? null : tdee - appliedDeficitKcal;
    const notes = [
        "基础代谢参考值为静息代谢估算；每日总消耗与摄入均为公式参考值，不是测量结果。",
        "每日总消耗已包含活动估算，不应额外叠加工作或训练消耗。",
    ];
    if (activityLevel === null) notes.push("请补充活动水平：久坐、轻度、中度或高强度；补选前每日总消耗和摄入不可用，不得自行补算。");
    if (intake !== null && intake <= 0) notes.push("每日摄入计算为非正数，摄入参考不可用；请核实画像或调整能量缺口，原画像未修改。");
    if (goal === "保持体型") notes.push("保持体型采用零缺口，画像中原有每日总能量缺口未修改。");

    return {
        formula: "Mifflin–St Jeor",
        unit: "千卡/日",
        input: { gender, age, heightCm, weightKg, activityLevel, goal, dailyEnergyDeficitKcal },
        activityFactor,
        appliedDeficitKcal,
        // 只对最终展示结果取整，不能先把基础代谢取整再计算总消耗。
        bmrKcal: Math.round(bmr),
        tdeeKcal: tdee === null ? null : Math.round(tdee),
        intakeKcal: intake === null || intake <= 0 ? null : Math.round(intake),
        notes,
    };
}
