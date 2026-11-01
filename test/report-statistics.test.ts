import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileRepository } from "../src/database.ts";
import { DailyRecordStore } from "../src/daily-record-store.ts";
import { calculateReportStatistics, readReportSnapshot, resolveReportPeriod, shanghaiDate } from "../src/reports/statistics.ts";
import { reportExercise, reportFood, reportProfile } from "./fixtures/report-data.ts";

test("报告采用上海日期、跨年自然周和闰年自然月", () => {
    assert.equal(shanghaiDate(Date.parse("2026-10-09T16:01:00Z")), "2026-10-10");
    const week = resolveReportPeriod({ type: "weekly", date: "2025-01-01" }, "2026-10-10");
    assert.equal(week.fromDate, "2024-12-30");
    assert.equal(week.toDate, "2025-01-05");
    assert.equal(week.dayCount, 7);
    assert.equal(resolveReportPeriod({ type: "monthly", month: "2024-02" }, "2026-10-10").toDate, "2024-02-29");
    const current = resolveReportPeriod({ type: "monthly", month: "2026-10" }, "2026-10-10");
    assert.equal(current.cutoffDate, "2026-10-10");
    assert.equal(current.dayCount, 10);
    assert.equal(current.ongoing, true);
    assert.throws(() => resolveReportPeriod({ type: "daily", date: "2025-02-29" }, "2026-10-10"), /有效/);
    assert.throws(() => resolveReportPeriod({ type: "monthly", month: "2025-13" }, "2026-10-10"), /月份/);
    assert.throws(() => resolveReportPeriod({ type: "yearly", year: 1.5 }, "2026-10-10"), /年份/);
    assert.throws(() => resolveReportPeriod({ type: "custom", fromDate: "2026-10-11", toDate: "2026-10-12" }, "2026-10-10"), /未来/);
    assert.throws(() => resolveReportPeriod({ type: "custom", fromDate: "2026-10-09", toDate: "2026-10-08" }, "2026-10-10"), /不能晚于/);
});

test("自定义范围包含边界并按完整跨度选择日、周、月粒度", () => {
    for (const [toDate, granularity] of [["2025-01-31", "day"], ["2025-02-01", "week"], ["2025-04-30", "week"], ["2025-05-01", "month"]] as const) {
        const period = resolveReportPeriod({ type: "custom", fromDate: "2025-01-01", toDate }, "2026-10-10");
        const stats = calculateReportStatistics({ period, records: [] });
        assert.equal(stats.granularity, granularity);
        assert.equal(stats.days[0].date, "2025-01-01");
        assert.equal(stats.days.at(-1)!.date, toDate);
        assert.equal(stats.groups[0].fromDate, "2025-01-01");
        assert.equal(stats.groups.at(-1)!.toDate, toDate);
    }
});

test("日均仅以饮食记录日为分母，缺失营养和历史参考保持未知", () => {
    const directory = mkdtempSync(join(tmpdir(), "report-stats-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    const store = new DailyRecordStore(repository.db);
    try {
        const profile = repository.save(reportProfile);
        store.addFood("2025-01-01", profile, reportFood);
        store.addFood("2025-01-01", profile, { ...reportFood, foodName: "米饭", caloriesKcal: 300, proteinG: null, fatG: 0 });
        store.addFood("2025-01-03", { ...profile, activityLevel: null }, { ...reportFood, caloriesKcal: 0 });
        store.addExercise("2025-01-02", profile, reportExercise);
        store.getOrCreate("2025-01-04", profile);
        repository.update({ weightKg: 90 });
        const period = resolveReportPeriod({ type: "weekly", date: "2025-01-01" }, "2026-10-10");
        const snapshot = readReportSnapshot(repository.db, store, period);
        const stats = calculateReportStatistics(snapshot);
        assert.equal(stats.totals.intakeKcal, 490);
        assert.equal(stats.totals.averageIntakeKcal, 245);
        assert.equal(stats.totals.foodDays, 2);
        assert.equal(stats.totals.exerciseDays, 1);
        assert.equal(stats.totals.dayCount, 7);
        assert.equal(stats.totals.exerciseMinutes, 30);
        assert.equal(stats.totals.exerciseKcal, 100);
        assert.equal(stats.totals.exerciseDistanceKm, 2);
        assert.deepEqual(stats.nutrition.proteinG, { totalG: 14, knownEntries: 2, totalEntries: 3 });
        assert.deepEqual(stats.nutrition.fiberG, { totalG: null, knownEntries: 0, totalEntries: 3 });
        assert.equal(stats.nutrition.fatG.totalG, 6);
        const foodDay = stats.days.find(day => day.date === "2025-01-01")!;
        assert.equal(foodDay.tdeeKcal, snapshot.records[0].summary.tdeeKcalSnapshot);
        assert.equal(foodDay.intakeDifferenceKcal, 490 - foodDay.intakeTargetKcal!);
        const exerciseDay = stats.days.find(day => day.date === "2025-01-02")!;
        assert.equal(exerciseDay.intakeKcal, null);
        assert.equal(exerciseDay.intakeDifferenceKcal, null);
        assert.equal(stats.days.find(day => day.date === "2025-01-03")!.intakeTargetKcal, null);
        assert.equal(stats.days.find(day => day.date === "2025-01-03")!.intakeKcal, 0);
        assert.equal(stats.days.find(day => day.date === "2025-01-04")!.intakeKcal, null);
        assert.equal(stats.days.find(day => day.date === "2025-01-05")!.bmrKcal, null);
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("年报从原始日期直接聚合十二个月，空月不会补零", () => {
    const period = resolveReportPeriod({ type: "yearly", year: 2024 }, "2026-10-10");
    const stats = calculateReportStatistics({ period, records: [] });
    assert.equal(stats.days.length, 366);
    assert.equal(stats.groups.length, 12);
    assert.equal(stats.groups[1].dayCount, 29);
    assert.equal(stats.groups[1].averageIntakeKcal, null);
    assert.equal(stats.totals.intakeKcal, null);
});
