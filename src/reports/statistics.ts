import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { DailyRecordStore } from "../daily-record-store.ts";
import { MEAL_TYPES, validateRecordDate } from "../daily-record.ts";
import type { ReportDay, ReportGroup, ReportPeriod, ReportRequest, ReportSnapshot, ReportStatistics, ReportTotals } from "./types.ts";

const DAY_MS = 86_400_000;

export function shanghaiDate(now: number): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayCount(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function monday(date: string): string {
    return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

export function resolveReportPeriod(request: ReportRequest, today: string): ReportPeriod {
    let fromDate: string;
    let toDate: string;
    if (request.type === "daily" || request.type === "weekly") {
        validateRecordDate(request.date);
        fromDate = request.type === "daily" ? request.date : monday(request.date);
        toDate = request.type === "daily" ? request.date : addDays(fromDate, 6);
    } else if (request.type === "monthly") {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month)) throw new Error("报告月份必须使用有效的 YYYY-MM 格式");
        fromDate = `${request.month}-01`;
        const next = new Date(`${fromDate}T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(next.getUTCDate() - 1);
        toDate = next.toISOString().slice(0, 10);
    } else if (request.type === "yearly") {
        if (!Number.isInteger(request.year) || request.year < 1 || request.year > 9999) throw new Error("报告年份必须为 1 到 9999 之间的整数");
        fromDate = `${String(request.year).padStart(4, "0")}-01-01`;
        toDate = `${String(request.year).padStart(4, "0")}-12-31`;
    } else {
        fromDate = request.fromDate;
        toDate = request.toDate;
    }
    validateRecordDate(fromDate);
    validateRecordDate(toDate);
    if (fromDate > toDate) throw new Error("报告开始日期不能晚于结束日期");
    if (fromDate > today) throw new Error("报告范围不能全部位于未来");
    const cutoffDate = toDate < today ? toDate : today;
    return { type: request.type, fromDate, toDate, cutoffDate, ongoing: toDate >= today, dayCount: dayCount(fromDate, cutoffDate) };
}

/** 短读事务保证每日快照与饮食、运动明细来自同一个数据库视图。 */
export function readReportSnapshot(db: DatabaseSync, records: DailyRecordStore, period: ReportPeriod): ReportSnapshot {
    db.exec("BEGIN");
    try {
        const dates = db.prepare("SELECT log_date FROM daily_records WHERE log_date BETWEEN ? AND ? ORDER BY log_date")
            .all(period.fromDate, period.cutoffDate) as { log_date: string }[];
        const snapshot = { period, records: dates.map((row) => records.getByDate(row.log_date)!) };
        db.exec("COMMIT");
        return snapshot;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

export function fingerprint(snapshot: ReportSnapshot): string {
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function mean(values: number[]): number | null { return values.length ? sum(values) / values.length : null; }

function totals(days: ReportDay[], distance: number | null = null): ReportTotals {
    const food = days.filter((day) => day.foodEntries > 0);
    const exercise = days.filter((day) => day.exerciseEntries > 0);
    return {
        dayCount: days.length, foodDays: food.length, exerciseDays: exercise.length,
        foodCoveragePct: food.length / days.length * 100, exerciseCoveragePct: exercise.length / days.length * 100,
        intakeKcal: food.length ? sum(food.map((day) => day.intakeKcal!)) : null,
        averageIntakeKcal: mean(food.map((day) => day.intakeKcal!)),
        exerciseMinutes: exercise.length ? sum(exercise.map((day) => day.exerciseMinutes!)) : null,
        exerciseKcal: exercise.length ? sum(exercise.map((day) => day.exerciseKcal!)) : null,
        exerciseDistanceKm: distance,
    };
}

export function calculateReportStatistics(snapshot: ReportSnapshot): ReportStatistics {
    const { period, records } = snapshot;
    const byDate = new Map(records.map((record) => [record.summary.logDate, record]));
    const days: ReportDay[] = [];
    for (let date = period.fromDate; date <= period.cutoffDate; date = addDays(date, 1)) {
        const record = byDate.get(date);
        const food = record?.foodEntries ?? [];
        const exercise = record?.exerciseEntries ?? [];
        const intake = food.length ? sum(food.map((entry) => entry.caloriesKcal)) : null;
        const target = record?.summary.intakeTargetKcalSnapshot ?? null;
        days.push({
            date, foodEntries: food.length, exerciseEntries: exercise.length, intakeKcal: intake,
            bmrKcal: record?.summary.bmrKcalSnapshot ?? null, tdeeKcal: record?.summary.tdeeKcalSnapshot ?? null,
            intakeTargetKcal: target, intakeDifferenceKcal: intake !== null && target !== null ? intake - target : null,
            exerciseMinutes: exercise.length ? sum(exercise.map((entry) => entry.durationMinutes)) : null,
            exerciseKcal: exercise.length ? sum(exercise.map((entry) => entry.caloriesBurnedKcal)) : null,
        });
    }
    const span = dayCount(period.fromDate, period.toDate);
    const granularity = period.type === "yearly" ? "month" : period.type === "monthly" ? "week"
        : period.type === "custom" ? span <= 31 ? "day" : span <= 120 ? "week" : "month" : "day";
    const grouped = new Map<string, ReportDay[]>();
    for (const day of days) {
        const label = granularity === "month" ? day.date.slice(0, 7) : granularity === "week" ? monday(day.date) : day.date;
        const group = grouped.get(label) ?? [];
        group.push(day);
        grouped.set(label, group);
    }
    const foods = records.flatMap((record) => record.foodEntries);
    const exercises = records.flatMap((record) => record.exerciseEntries);
    const distances = exercises.flatMap((entry) => entry.distanceKm === null ? [] : [entry.distanceKm]);
    const nutrition = {} as ReportStatistics["nutrition"];
    for (const key of ["proteinG", "carbsG", "fatG", "fiberG"] as const) {
        const known = foods.flatMap((entry) => entry[key] === null ? [] : [entry[key]]);
        nutrition[key] = { totalG: known.length ? sum(known) : null, knownEntries: known.length, totalEntries: foods.length };
    }
    const exerciseTypes = new Map<string, ReportStatistics["exercises"][number]>();
    for (const entry of exercises) {
        const group = exerciseTypes.get(entry.exerciseName) ?? { name: entry.exerciseName, entries: 0, minutes: 0, caloriesKcal: 0 };
        group.entries++;
        group.minutes += entry.durationMinutes;
        group.caloriesKcal += entry.caloriesBurnedKcal;
        exerciseTypes.set(entry.exerciseName, group);
    }
    const groups: ReportGroup[] = [...grouped].map(([label, items]) => ({
        ...totals(items), label, fromDate: items[0].date, toDate: items.at(-1)!.date,
        averageIntakeTargetKcal: mean(items.filter((day) => day.foodEntries > 0 && day.intakeTargetKcal !== null).map((day) => day.intakeTargetKcal!)),
    }));
    return {
        totals: totals(days, distances.length ? sum(distances) : null), days, groups, granularity, nutrition,
        meals: MEAL_TYPES.map((mealType) => {
            const entries = foods.filter((food) => food.mealType === mealType);
            return { mealType, caloriesKcal: entries.length ? sum(entries.map((entry) => entry.caloriesKcal)) : null, entries: entries.length };
        }),
        exercises: [...exerciseTypes.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "zh-CN")),
    };
}
