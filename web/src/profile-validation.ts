import type { ProfileFormDefinition, ProfileInput } from "./api";

export type ProfileErrors = Partial<Record<keyof ProfileInput | "form", string>>;

export function validateProfileForm(input: ProfileInput, definition: ProfileFormDefinition): ProfileErrors {
    const errors: ProfileErrors = {};
    const numberFields: Array<[keyof ProfileInput, string]> = [
        ["age", "年龄"], ["weightKg", "体重"], ["heightCm", "身高"], ["bodyFatPct", "体脂率"],
        ["waistCm", "腰围"], ["dailyEnergyDeficitKcal", "每日总能量缺口"],
    ];
    for (const [field, label] of numberFields) {
        const value = input[field] as number;
        const constraint = definition.constraints[field as keyof typeof definition.constraints] as { minimum: number; maximum?: number; integer?: boolean };
        if (!Number.isFinite(value) || value < constraint.minimum || (constraint.maximum !== undefined && value > constraint.maximum) || (constraint.integer && !Number.isInteger(value))) {
            errors[field] = `${label}需在 ${constraint.minimum} 到 ${constraint.maximum} 之间${constraint.integer ? "，且为整数" : ""}`;
        }
    }
    if (input.hipCm !== null) {
        const { minimum, maximum } = definition.constraints.hipCm;
        if (!Number.isFinite(input.hipCm) || input.hipCm < minimum || input.hipCm > (maximum ?? Infinity)) errors.hipCm = `臀围需在 ${minimum} 到 ${maximum} 之间`;
    }
    const target = definition.constraints.targetBodyFatPct;
    if (!Number.isFinite(input.targetBodyFatPct) || input.targetBodyFatPct < target.minimum || input.targetBodyFatPct > input.bodyFatPct) {
        errors.targetBodyFatPct = `目标体脂率需在 ${target.minimum}% 到当前体脂率之间`;
    }
    const required: Array<[keyof ProfileInput, string]> = [
        ["gender", "请选择性别"], ["goal", "请选择计划目标"], ["dietExercisePreference", "请选择吃动偏好"],
        ["activityFrequency", "请选择运动频次"], ["jobType", "请选择工作类型"], ["stairResponse", "请选择爬楼反应"], ["focusArea", "请选择重点部位"],
    ];
    for (const [field, message] of required) if (!input[field]) errors[field] = message;

    if (input.favoriteExercises.length > definition.constraints.favoriteExercises.maximum) errors.favoriteExercises = `喜欢的运动最多选择 ${definition.constraints.favoriteExercises.maximum} 项`;
    const equipment = definition.constraints.equipment;
    if (input.equipment.length < equipment.minimum) errors.equipment = "请至少选择一种器械情况";
    if (equipment.exclusive && input.equipment.includes(equipment.exclusive) && input.equipment.length > 1) errors.equipment = `“${equipment.exclusive}”不能与其他选项同时选择`;
    const days = definition.constraints.trainingDays;
    if (input.trainingDays.length < days.minimum || input.trainingDays.length > days.maximum) errors.trainingDays = `每周训练日请选择 ${days.minimum} 到 ${days.maximum} 天`;
    return errors;
}

