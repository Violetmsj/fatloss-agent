export const MEAL_TYPES = ["早餐", "午餐", "晚餐", "加餐"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

export const CALORIE_CONFIDENCES = ["low", "medium", "high"] as const;
export type CalorieConfidence = (typeof CALORIE_CONFIDENCES)[number];

export const FOOD_CALORIE_SOURCE_TYPES = ["user_provided", "nutrition_label", "local_food_database", "web_estimate"] as const;
export type FoodCalorieSourceType = (typeof FOOD_CALORIE_SOURCE_TYPES)[number];

export const EXERCISE_CALORIE_SOURCE_TYPES = ["wearable", "met_formula", "user_provided"] as const;
export type ExerciseCalorieSourceType = (typeof EXERCISE_CALORIE_SOURCE_TYPES)[number];

export const REPORTED_CALORIE_BASES = ["active", "total", "unknown"] as const;
export type ReportedCalorieBasis = (typeof REPORTED_CALORIE_BASES)[number];

export interface CalorieProvenanceInput<TSource extends string> {
    calorieSourceType?: TSource | null;
    calorieSourceRef?: string | null;
    calorieEstimateLowKcal?: number | null;
    calorieEstimateHighKcal?: number | null;
    calorieConfidence?: CalorieConfidence | null;
    calorieEstimationNote?: string | null;
}

export interface CalorieProvenance<TSource extends string> {
    calorieSourceType: TSource | null;
    calorieSourceRef: string | null;
    calorieEstimateLowKcal: number | null;
    calorieEstimateHighKcal: number | null;
    calorieConfidence: CalorieConfidence | null;
    calorieEstimationNote: string | null;
}

export interface DailyRecord {
    id: number;
    logDate: string;
    bmrKcalSnapshot: number;
    tdeeKcalSnapshot: number | null;
    intakeTargetKcalSnapshot: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface FoodEntryInput extends CalorieProvenanceInput<FoodCalorieSourceType> {
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

export interface FoodEntry extends Omit<FoodEntryInput, keyof CalorieProvenanceInput<FoodCalorieSourceType>>, CalorieProvenance<FoodCalorieSourceType> {
    id: number;
    dailyRecordId: number;
    createdAt: string;
    updatedAt: string;
}

export interface ExerciseEntryInput extends CalorieProvenanceInput<ExerciseCalorieSourceType> {
    exerciseName: string;
    durationMinutes: number;
    caloriesBurnedKcal: number;
    intensity: string | null;
    startedAt: string | null;
    distanceKm: number | null;
    note: string | null;
    metValue?: number | null;
    reportedCaloriesKcal?: number | null;
    reportedCalorieBasis?: ReportedCalorieBasis | null;
}

export interface ExerciseEntry extends Omit<ExerciseEntryInput, keyof CalorieProvenanceInput<ExerciseCalorieSourceType> | "metValue" | "reportedCaloriesKcal" | "reportedCalorieBasis">, CalorieProvenance<ExerciseCalorieSourceType> {
    id: number;
    dailyRecordId: number;
    metValue: number | null;
    reportedCaloriesKcal: number | null;
    reportedCalorieBasis: ReportedCalorieBasis | null;
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

function normalizeProvenance<TSource extends string>(
    input: CalorieProvenanceInput<TSource>,
    caloriesKcal: number,
    sourceTypes: readonly TSource[],
): CalorieProvenance<TSource> {
    // 区间是一个不可拆分的整体；禁止只保存一侧，或让中心值落在区间之外。
    // 这层校验也覆盖从旧表迁移来的数据库，因为旧表新增列无法补上完整 CHECK 约束。
    const low = input.calorieEstimateLowKcal ?? null;
    const high = input.calorieEstimateHighKcal ?? null;
    if ((low === null) !== (high === null)) throw new Error("热量估算区间上下界必须同时填写或同时留空");
    if (low !== null && high !== null) {
        validateNumber("热量估算下界", low, 0, true);
        validateNumber("热量估算上界", high, 0, true);
        if (low > caloriesKcal || caloriesKcal > high) throw new Error("热量估算必须满足下界 ≤ 热量 ≤ 上界");
    }
    const sourceType = input.calorieSourceType ?? null;
    if (sourceType !== null && !sourceTypes.includes(sourceType)) throw new Error("热量来源类型无效");
    const confidence = input.calorieConfidence ?? null;
    if (confidence !== null && !CALORIE_CONFIDENCES.includes(confidence)) throw new Error("热量置信度无效");
    return {
        calorieSourceType: sourceType,
        calorieSourceRef: normalizeOptionalText(input.calorieSourceRef ?? null),
        calorieEstimateLowKcal: low,
        calorieEstimateHighKcal: high,
        calorieConfidence: confidence,
        calorieEstimationNote: normalizeOptionalText(input.calorieEstimationNote ?? null),
    };
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
        ...normalizeProvenance(input, input.caloriesKcal, FOOD_CALORIE_SOURCE_TYPES),
        foodName: validateText("食物名称", input.foodName),
        unit: input.unit === null ? null : validateText("食物单位", input.unit),
        note: normalizeOptionalText(input.note),
    };
}

export function normalizeExerciseInput(input: ExerciseEntryInput): ExerciseEntryInput {
    validateNumber("运动时长", input.durationMinutes, 0, false);
    validateNumber("运动消耗", input.caloriesBurnedKcal, 0, true);
    validateOptionalNumber("运动距离", input.distanceKm, 0, false);
    validateOptionalNumber("MET", input.metValue ?? null, 1, true);
    validateOptionalNumber("设备报告热量", input.reportedCaloriesKcal ?? null, 0, true);
    // reportedCaloriesKcal 保留设备原始读数，caloriesBurnedKcal 才是统一后的活动热量。
    const reportedCalorieBasis = input.reportedCalorieBasis ?? null;
    if (reportedCalorieBasis !== null && !REPORTED_CALORIE_BASES.includes(reportedCalorieBasis)) throw new Error("设备热量口径无效");
    validateOptionalIsoTime("运动开始时间", input.startedAt);
    return {
        ...input,
        ...normalizeProvenance(input, input.caloriesBurnedKcal, EXERCISE_CALORIE_SOURCE_TYPES),
        exerciseName: validateText("运动名称", input.exerciseName),
        intensity: normalizeOptionalText(input.intensity),
        note: normalizeOptionalText(input.note),
        metValue: input.metValue ?? null,
        reportedCaloriesKcal: input.reportedCaloriesKcal ?? null,
        reportedCalorieBasis,
    };
}
