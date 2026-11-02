import type { CalorieConfidence, ReportedCalorieBasis } from "./daily-record.ts";

export interface ExerciseCalorieEstimate {
    caloriesKcal: number;
    lowKcal: number | null;
    highKcal: number | null;
    confidence: CalorieConfidence | null;
    note: string;
    requiresConfirmation: boolean;
}

function nonNegative(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name}必须是不小于 0 的数值`);
}

export function calculateActiveCaloriesFromMet(met: number, weightKg: number, durationMinutes: number): number {
    if (!Number.isFinite(met) || met < 1) throw new Error("MET 必须不小于 1");
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error("体重必须大于 0");
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("运动时长必须大于 0");
    // 减去 1 MET 的静息部分，只得到活动热量，避免和已包含日常活动的 TDEE 重复计算。
    return Math.round(((met - 1) * 3.5 * weightKg / 200 * durationMinutes) * 100) / 100;
}

export function calculateMetRange(
    met: number,
    metLow: number,
    metHigh: number,
    weightKg: number,
    durationMinutes: number,
    confidence: CalorieConfidence,
): ExerciseCalorieEstimate {
    if (metLow > met || met > metHigh) throw new Error("MET 必须满足下界 ≤ 中心值 ≤ 上界");
    return {
        caloriesKcal: calculateActiveCaloriesFromMet(met, weightKg, durationMinutes),
        lowKcal: calculateActiveCaloriesFromMet(metLow, weightKg, durationMinutes),
        highKcal: calculateActiveCaloriesFromMet(metHigh, weightKg, durationMinutes),
        confidence,
        note: "按 Compendium 口径，以 (MET - 1) 计算活动热量；结果不叠加到 TDEE。",
        requiresConfirmation: true,
    };
}

export function normalizeWearableCalories(
    reportedCaloriesKcal: number,
    basis: ReportedCalorieBasis,
    weightKg: number,
    durationMinutes: number,
): ExerciseCalorieEstimate {
    nonNegative("设备报告热量", reportedCaloriesKcal);
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error("体重必须大于 0");
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("运动时长必须大于 0");
    if (basis === "active") {
        // 设备已经给出活动热量时不再转换，也不伪造估算区间或置信度。
        return { caloriesKcal: reportedCaloriesKcal, lowKcal: null, highKcal: null, confidence: null, note: "采用设备报告的活动热量。", requiresConfirmation: false };
    }
    if (basis === "total") {
        // 设备总热量含静息消耗，按约 1 kcal/kg/小时扣除后统一成活动热量。
        const caloriesKcal = Math.max(0, reportedCaloriesKcal - weightKg * durationMinutes / 60);
        return { caloriesKcal: Math.round(caloriesKcal * 100) / 100, lowKcal: null, highKcal: null, confidence: "medium", note: "设备报告的是总热量，已减去按 1 kcal/kg/小时估算的静息消耗。", requiresConfirmation: true };
    }
    // 口径未知时保留原值作为低置信度代理，必须交给用户确认，不能假装精确转换。
    return { caloriesKcal: reportedCaloriesKcal, lowKcal: null, highKcal: null, confidence: "low", note: "设备热量口径未知，暂作为活动热量代理值。", requiresConfirmation: true };
}
