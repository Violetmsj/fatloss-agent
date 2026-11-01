import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileRepository } from "../src/database.ts";
import { DailyRecordStore } from "../src/daily-record-store.ts";
import { parseReportSummary, ReportService, type SummaryGenerator } from "../src/reports/service.ts";
import { nutritionText } from "../src/reports/markdown.ts";
import type { ReportRequest } from "../src/reports/types.ts";
import { reportExercise, reportFood, reportProfile, reportSummary } from "./fixtures/report-data.ts";

async function fixture(run: (context: { repository: ProfileRepository; records: DailyRecordStore; service: ReportService; directory: string; setNow: (value: number) => void }) => Promise<void>): Promise<void> {
    const directory = mkdtempSync(join(tmpdir(), "report-service-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    let now = Date.parse("2026-10-10T04:00:00Z");
    const records = new DailyRecordStore(repository.db, () => now);
    const service = new ReportService(repository.db, () => now, 20);
    const profile = repository.save(reportProfile);
    records.addFood("2025-01-01", profile, reportFood);
    records.addExercise("2025-01-01", profile, reportExercise);
    try { await run({ repository, records, service, directory, setNow: value => { now = value; } }); }
    finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
}

const generator: SummaryGenerator = { model: "fake/model", generate: async () => JSON.stringify(reportSummary) };

test("报告重复生成复用，数据改变后手动生成新版并保留旧快照", () => fixture(async ({ service, records, repository }) => {
    let calls = 0;
    const model = { ...generator, generate: async () => { calls++; return JSON.stringify(reportSummary); } };
    const request = { type: "daily" as const, date: "2025-01-01" };
    const first = await service.generate(request, model);
    assert.equal(first.summaryStatus, "complete");
    assert.equal(first.stale, false);
    assert.equal((await service.generate({ ...request, regenerate: true }, model)).id, first.id);
    assert.equal(calls, 1);
    records.addFood("2025-01-01", repository.get()!, { ...reportFood, foodName: "午餐", caloriesKcal: 500 });
    assert.equal(service.get(first.id)!.stale, true);
    const unchanged = await service.generate(request, model);
    assert.equal(unchanged.id, first.id);
    assert.equal(unchanged.statistics.totals.intakeKcal, 190);
    assert.equal(calls, 1);
    const updated = await service.generate({ ...request, regenerate: true }, model);
    assert.equal(updated.version, 2);
    assert.equal(updated.statistics.totals.intakeKcal, 690);
    assert.equal(updated.versions.length, 2);
    assert.equal(service.get(first.id)!.markdown, first.markdown);
    records.deleteDay("2025-01-01");
    assert.equal(service.get(updated.id)!.stale, true);
    assert.equal((await service.generate({ ...request, regenerate: true }, model)).summaryStatus, "not_applicable");
    assert.equal(calls, 2);
}));

test("报告重启后可读取，分页筛选和旧库重复初始化保留原数据", () => fixture(async ({ service, repository, directory }) => {
    const first = await service.generate({ type: "weekly", date: "2025-01-01" }, generator);
    const reopened = new ProfileRepository(join(directory, "test.sqlite"));
    try {
        const second = new ReportService(reopened.db, service.now);
        assert.equal(second.get(first.id)!.markdown, first.markdown);
        assert.equal(second.store.list({ type: "weekly", fromDate: "2025-01-01", toDate: "2025-01-01" }).total, 1);
        assert.equal(second.store.list({ type: "monthly" }).total, 0);
        assert.equal(second.store.list({ page: 2, pageSize: 1 }).reports.length, 0);
        assert.throws(() => second.store.list({ pageSize: 51 }), /分页/);
        assert.throws(() => second.store.list({ fromDate: "2025-02-30" }), /有效/);
        assert.equal(repository.get()!.weightKg, 70);
    } finally { reopened.close(); }
}));

test("失败或非法总结保留统计，明确重试才补齐已存总结", () => fixture(async ({ service }) => {
    for (const [date, generate] of [["2025-01-01", async () => { throw new Error("private provider error"); }]] as const) {
        const failed = await service.generate({ type: "daily", date }, { model: "fake/fail", generate });
        assert.equal(failed.summaryStatus, "failed");
        assert.equal(failed.statistics.totals.intakeKcal, 190);
        assert.equal(failed.summaryError!.includes("private"), false);
        const untouched = await service.generate({ type: "daily", date }, generator);
        assert.equal(untouched.summaryStatus, "failed");
        const retry = await service.generate({ type: "daily", date, regenerate: true }, generator);
        assert.equal(retry.id, failed.id);
        assert.deepEqual(retry.summary, reportSummary);
        assert.equal(retry.summaryStatus, "complete");
    }
    const invalid = await service.generate({ type: "weekly", date: "2025-01-01" }, { model: "fake/invalid", generate: async () => '{"overview":"缺少字段"}' });
    assert.equal(invalid.summaryStatus, "failed");
    assert.match(invalid.markdown, /统计已保存/);
    assert.throws(() => parseReportSummary(JSON.stringify({ ...reportSummary, extra: "unexpected" })), /字段/);
    assert.equal(nutritionText({ totalG: 7, knownEntries: 1, totalEntries: 2 }), "7 克（已知部分合计）");
}));

test("总结超时与用户取消会保留统计且结束请求", () => fixture(async ({ service }) => {
    // 保持事件循环存活，AbortSignal.timeout 本身不会阻止 Node 退出。
    const timer = setInterval(() => {}, 100);
    try {
        const never = { model: "fake/never", generate: async () => new Promise<string>(() => {}) };
        const timeout = await service.generate({ type: "daily", date: "2025-01-01" }, never);
        assert.equal(timeout.summaryStatus, "failed");
        assert.match(timeout.summaryError!, /超时/);
        const controller = new AbortController();
        controller.abort();
        const cancelled = await service.generate({ type: "weekly", date: "2025-01-01" }, generator, controller.signal);
        assert.equal(cancelled.summaryStatus, "failed");
        assert.match(cancelled.summaryError!, /取消/);
    } finally { clearInterval(timer); }
}));

test("两个数据库连接并发生成同快照只调用一次模型，租约到期可重试", () => fixture(async ({ service, directory, setNow }) => {
    const otherRepository = new ProfileRepository(join(directory, "test.sqlite"));
    const other = new ReportService(otherRepository.db, service.now, 20);
    let release: (text: string) => void = () => {};
    let calls = 0;
    const delayed = { model: "fake/delayed", generate: () => { calls++; return new Promise<string>(resolve => { release = resolve; }); } };
    try {
        const request = { type: "daily" as const, date: "2025-01-01" };
        const running = service.generate(request, delayed);
        const duplicate = await other.generate({ ...request, regenerate: true }, delayed);
        assert.equal(duplicate.summaryStatus, "pending");
        assert.equal(calls, 1);
        release(JSON.stringify(reportSummary));
        assert.equal((await running).id, duplicate.id);
        assert.equal(other.get(duplicate.id)!.summaryStatus, "complete");

        // 模拟在领取租约后进程退出，下一进程不得永久卡住。
        otherRepository.db.prepare("UPDATE reports SET summary_status = 'pending', summary_json = NULL, lease_token = 'abandoned', lease_expires_at = ? WHERE id = ?")
            .run(service.now() + 60_000, duplicate.id);
        setNow(service.now() + 60_001);
        assert.equal((await other.generate({ ...request, regenerate: true }, generator)).summaryStatus, "complete");
    } finally { otherRepository.close(); }
}));

test("当前周期推进使报告过期，空数据不调用模型", () => fixture(async ({ service, setNow }) => {
    let calls = 0;
    const model = { ...generator, generate: async () => { calls++; return JSON.stringify(reportSummary); } };
    const empty = await service.generate({ type: "monthly", month: "2026-10" }, model);
    assert.equal(empty.summaryStatus, "not_applicable");
    assert.equal(calls, 0);
    setNow(Date.parse("2026-10-11T04:00:00Z"));
    assert.equal(service.get(empty.id)!.stale, true);
    const updated = await service.generate({ type: "monthly", month: "2026-10", regenerate: true }, model);
    assert.equal(updated.version, 2);
    assert.equal(updated.statistics.totals.dayCount, 11);
}));

test("总结期间补记不会改变已冻结指标，返回结果会标注过期", () => fixture(async ({ service, records, repository }) => {
    const report = await service.generate({ type: "daily", date: "2025-01-01" }, {
        model: "fake/changed", generate: async (input) => {
            assert.equal(JSON.parse(input).totals.intakeKcal, 190);
            records.addFood("2025-01-01", repository.get()!, { ...reportFood, caloriesKcal: 500 });
            return JSON.stringify(reportSummary);
        },
    });
    assert.equal(report.statistics.totals.intakeKcal, 190);
    assert.equal(report.snapshot.records[0].foodEntries.length, 1);
    assert.equal(report.stale, true);
}));

test("旧租约晚到的总结不能覆盖重试后已保存的总结", () => fixture(async ({ service, setNow }) => {
    let release: (text: string) => void = () => {};
    const request = { type: "daily" as const, date: "2025-01-01" };
    const old = service.generate(request, { model: "fake/old", generate: () => new Promise<string>(resolve => { release = resolve; }) });
    setNow(service.now() + 60_001);
    const freshSummary = { ...reportSummary, overview: "租约恢复后的总结。" };
    const retry = await service.generate({ ...request, regenerate: true }, { model: "fake/new", generate: async () => JSON.stringify(freshSummary) });
    release(JSON.stringify(reportSummary));
    const oldResult = await old;
    assert.equal(oldResult.id, retry.id);
    assert.equal(oldResult.summary!.overview, freshSummary.overview);
    assert.equal(oldResult.model, "fake/new");
}));

test("五套 Markdown 内容独立且年报无需预先生成日报或月报", () => fixture(async ({ service, records, repository }) => {
    for (let month = 2; month <= 12; month++) {
        if (month === 7) continue;
        records.addFood(`2025-${String(month).padStart(2, "0")}-05`, repository.get()!, reportFood);
    }
    const requests: [ReportRequest, string][] = [
        [{ type: "daily", date: "2025-01-01" }, "当日能量参考"], [{ type: "weekly", date: "2025-01-01" }, "七天饮食与运动节奏"],
        [{ type: "monthly", month: "2025-01" }, "当月记录日历"], [{ type: "yearly", year: 2025 }, "十二个月趋势与覆盖情况"],
        [{ type: "custom", fromDate: "2025-01-01", toDate: "2025-06-01" }, "区间展示粒度"],
    ];
    for (const [request, title] of requests) {
        const report = await service.generate(request, generator);
        assert.ok(report.markdown.includes(title));
        assert.ok(report.markdown.includes("已记录摄入"));
        if (request.type === "yearly") {
            assert.equal(report.statistics.groups.length, 12);
            assert.equal(report.statistics.totals.foodDays, 11);
            assert.equal(report.statistics.groups[6].intakeKcal, null);
        }
    }
}));
