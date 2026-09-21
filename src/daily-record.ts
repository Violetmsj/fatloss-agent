export const MEAL_TYPES = ["早餐", "午餐", "晚餐", "加餐"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

export interface DailyRecord {
    id: number;
    logDate: string;
    bmrKcalSnapshot: number;
    tdeeKcalSnapshot: number | null;
    intakeTargetKcalSnapshot: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface FoodEntryInput {
    mealType: MealType;
    foodName: string;
    amount: number | null;
    unit: string | null;
    caloriesKcal: number;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    eatenAt: string | null;
    note: string | null;
}

export interface FoodEntry extends FoodEntryInput {
    id: number;
    dailyRecordId: number;
    createdAt: string;
    updatedAt: string;
}

export interface ExerciseEntryInput {
    exerciseName: string;
    durationMinutes: number;
    caloriesBurnedKcal: number;
    intensity: string | null;
    startedAt: string | null;
    distanceKm: number | null;
    note: string | null;
}

export interface ExerciseEntry extends ExerciseEntryInput {
    id: number;
    dailyRecordId: number;
    createdAt: string;
    updatedAt: string;
}

export interface DailyRecordSummary extends DailyRecord {
    mealIntakeKcal: Record<MealType, number>;
    totalIntakeKcal: number;
    totalExerciseKcal: number;
}

export interface DailyRecordDetails {
    summary: DailyRecordSummary;
    foodEntries: FoodEntry[];
    exerciseEntries: ExerciseEntry[];
}

function isMealType(value: string): value is MealType {
    return MEAL_TYPES.includes(value as MealType);
}

export function validateRecordDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("记录日期必须使用 YYYY-MM-DD 格式");
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw new Error("记录日期不是有效日历日期");
    }
}

function validateOptionalIsoTime(name: string, value: string | null): void {
    if (value === null) return;
    const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/);
    const timestamp = Date.parse(value);
    if (!match || !Number.isFinite(timestamp)) {
        throw new Error(`${name}必须是包含时区的 ISO 日期时间`);
    }
    const offset = match[2] === "Z" ? 0 : (Number(match[4]) * 60 + Number(match[5])) * (match[3] === "+" ? 1 : -1);
    if (new Date(timestamp + offset * 60000).toISOString().slice(0, 19) !== match[1]) {
        throw new Error(`${name}不是有效日历时间`);
    }
}

function validateText(name: string, value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${name}不能为空`);
    return normalized;
}

function normalizeOptionalText(value: string | null): string | null {
    if (value === null) return null;
    const normalized = value.trim();
    return normalized || null;
}

function validateNumber(name: string, value: number, minimum: number, allowMinimum: boolean): void {
    if (!Number.isFinite(value) || (allowMinimum ? value < minimum : value <= minimum)) {
        throw new Error(`${name}必须是${allowMinimum ? "不小于" : "大于"}${minimum}的数值`);
    }
}

function validateOptionalNumber(name: string, value: number | null, minimum: number, allowMinimum: boolean): void {
    if (value !== null) validateNumber(name, value, minimum, allowMinimum);
}

export function normalizeFoodInput(input: FoodEntryInput): FoodEntryInput {
    if (!isMealType(input.mealType)) throw new Error("餐次必须是早餐、午餐、晚餐或加餐");
    if ((input.amount === null) !== (input.unit === null)) throw new Error("食物数量和单位必须同时填写或同时留空");
    validateOptionalNumber("食物数量", input.amount, 0, false);
    validateNumber("食物热量", input.caloriesKcal, 0, true);
    validateOptionalNumber("蛋白质", input.proteinG, 0, true);
    validateOptionalNumber("碳水", input.carbsG, 0, true);
    validateOptionalNumber("脂肪", input.fatG, 0, true);
    validateOptionalNumber("膳食纤维", input.fiberG, 0, true);
    validateOptionalIsoTime("进食时间", input.eatenAt);
    return {
        ...input,
        foodName: validateText("食物名称", input.foodName),
        unit: input.unit === null ? null : validateText("食物单位", input.unit),
        note: normalizeOptionalText(input.note),
    };
}

export function normalizeExerciseInput(input: ExerciseEntryInput): ExerciseEntryInput {
    validateNumber("运动时长", input.durationMinutes, 0, false);
    validateNumber("运动消耗", input.caloriesBurnedKcal, 0, true);
    validateOptionalNumber("运动距离", input.distanceKm, 0, false);
    validateOptionalIsoTime("运动开始时间", input.startedAt);
    return {
        ...input,
        exerciseName: validateText("运动名称", input.exerciseName),
        intensity: normalizeOptionalText(input.intensity),
        note: normalizeOptionalText(input.note),
    };
}
