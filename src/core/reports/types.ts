import type { DailyRecordDetails, MealType } from "../daily-record.ts";

export const REPORT_TYPES = ["daily", "weekly", "monthly", "yearly", "custom"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TITLES: Record<ReportType, string> = {
    daily: "减脂日报", weekly: "减脂周报", monthly: "减脂月报", yearly: "减脂年报", custom: "自定义减脂报告",
};

export type ReportRequest = (
    | { type: "daily"; date: string }
    | { type: "weekly"; date: string }
    | { type: "monthly"; month: string }
    | { type: "yearly"; year: number }
    | { type: "custom"; fromDate: string; toDate: string }
) & { regenerate?: boolean };

export interface ReportPeriod {
    type: ReportType;
    fromDate: string;
    toDate: string;
    cutoffDate: string;
    ongoing: boolean;
    dayCount: number;
}

export interface NutritionStat {
    totalG: number | null;
    knownEntries: number;
    totalEntries: number;
}

export interface ReportTotals {
    dayCount: number;
    foodDays: number;
    exerciseDays: number;
    foodCoveragePct: number;
    exerciseCoveragePct: number;
    intakeKcal: number | null;
    averageIntakeKcal: number | null;
    exerciseMinutes: number | null;
    exerciseKcal: number | null;
    exerciseDistanceKm: number | null;
}

export interface ReportDay {
    date: string;
    foodEntries: number;
    exerciseEntries: number;
    intakeKcal: number | null;
    bmrKcal: number | null;
    tdeeKcal: number | null;
    intakeTargetKcal: number | null;
    intakeDifferenceKcal: number | null;
    exerciseMinutes: number | null;
    exerciseKcal: number | null;
}

export interface ReportGroup extends ReportTotals {
    label: string;
    fromDate: string;
    toDate: string;
    averageIntakeTargetKcal: number | null;
}

export interface ReportStatistics {
    totals: ReportTotals;
    days: ReportDay[];
    groups: ReportGroup[];
    granularity: "day" | "week" | "month";
    meals: { mealType: MealType; caloriesKcal: number | null; entries: number }[];
    nutrition: Record<"proteinG" | "carbsG" | "fatG" | "fiberG", NutritionStat>;
    exercises: { name: string; entries: number; minutes: number; caloriesKcal: number }[];
}

export interface ReportSnapshot {
    period: ReportPeriod;
    records: DailyRecordDetails[];
}

export interface ReportSummary {
    overview: string;
    observations: string[];
    limitations: string[];
    nextSteps: string[];
}

export type SummaryStatus = "pending" | "complete" | "failed" | "not_applicable";

export interface ReportMetadata {
    id: string;
    type: ReportType;
    fromDate: string;
    toDate: string;
    cutoffDate: string;
    ongoing: boolean;
    version: number;
    createdAt: string;
    summaryStatus: SummaryStatus;
    model: string | null;
    schemaVersion: number;
    templateVersion: number;
}

export interface SavedReport extends ReportMetadata {
    sourceFingerprint: string;
    snapshot: ReportSnapshot;
    statistics: ReportStatistics;
    summary: ReportSummary | null;
    summaryError: string | null;
    markdown: string;
}

export interface ReportView extends SavedReport {
    stale: boolean;
    versions: ReportMetadata[];
}

export interface ReportFilter {
    type?: ReportType;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
}

export interface ReportList {
    reports: ReportMetadata[];
    total: number;
    page: number;
    pageSize: number;
}
