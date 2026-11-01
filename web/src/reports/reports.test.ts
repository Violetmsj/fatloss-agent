// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import type { ReportView, ReportDay, ReportTotals } from "../../../src/reports/types.ts";
import { renderReportMarkdown } from "../../../src/reports/markdown.ts";
import DailyReport from "../components/reports/DailyReport.vue";
import WeeklyReport from "../components/reports/WeeklyReport.vue";
import MonthlyReport from "../components/reports/MonthlyReport.vue";
import YearlyReport from "../components/reports/YearlyReport.vue";
import CustomReport from "../components/reports/CustomReport.vue";
import ReportMetrics from "../components/reports/ReportMetrics.vue";
import ReportPage from "../views/ReportView.vue";
import ReportsPage from "../views/ReportsView.vue";
import ToolOutput from "../components/ai-elements/tool/ToolOutput.vue";
import { api } from "../api";
import { intakeChart, exerciseChart } from "./charts";

vi.mock("../components/reports/ReportChart.vue", () => ({ default: { props: ["title"], template: '<section class="chart-stub">{{ title }}</section>' } }));
vi.mock("../components/ai-elements/code-block", () => ({ CodeBlock: { props: ["code"], template: '<pre>{{ code }}</pre>' } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(type: ReportView["type"] = "daily"): ReportView {
    const dayCount = type === "yearly" ? 365 : type === "monthly" ? 31 : type === "weekly" ? 7 : 1;
    const period = { type, fromDate: "2025-01-01", toDate: type === "yearly" ? "2025-12-31" : `2025-01-${String(dayCount).padStart(2, "0")}`, cutoffDate: "", ongoing: false, dayCount };
    period.cutoffDate = period.toDate;
    const snapshot = { period, records: [] };
    const days: ReportDay[] = Array.from({ length: dayCount }, (_, index) => ({
        date: new Date(Date.parse("2025-01-01T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10),
        foodEntries: 0, exerciseEntries: 0, intakeKcal: null, bmrKcal: null, tdeeKcal: null, intakeTargetKcal: null,
        intakeDifferenceKcal: null, exerciseMinutes: null, exerciseKcal: null,
    }));
    const totals: ReportTotals = { dayCount, foodDays: 0, exerciseDays: 0, foodCoveragePct: 0, exerciseCoveragePct: 0,
        intakeKcal: null, averageIntakeKcal: null, exerciseMinutes: null, exerciseKcal: null, exerciseDistanceKm: null };
    const groups = type === "yearly" ? Array.from({ length: 12 }, (_, index) => {
        const month = `2025-${String(index + 1).padStart(2, "0")}`;
        const items = days.filter(day => day.date.startsWith(month));
        return { ...totals, dayCount: items.length, label: month, fromDate: items[0].date, toDate: items.at(-1)!.date, averageIntakeTargetKcal: null };
    }) : days.map(day => ({ ...totals, dayCount: 1, label: day.date, fromDate: day.date, toDate: day.date, averageIntakeTargetKcal: null }));
    const unknownNutrition = { totalG: null, knownEntries: 0, totalEntries: 0 };
    const report: ReportView = {
        id: "12345678-1234-1234-1234-123456789abc", type, fromDate: period.fromDate, toDate: period.toDate, cutoffDate: period.cutoffDate,
        ongoing: false, version: 1, createdAt: "2026-10-10T04:00:00Z", summaryStatus: "not_applicable", model: null,
        schemaVersion: 1, templateVersion: 1, sourceFingerprint: "test", snapshot,
        statistics: { totals, days, groups, granularity: type === "yearly" ? "month" : "day", exercises: [],
            nutrition: { proteinG: unknownNutrition, carbsG: unknownNutrition, fatG: unknownNutrition, fiberG: unknownNutrition },
            meals: ["早餐", "午餐", "晚餐", "加餐"].map(mealType => ({ mealType, entries: 0, caloriesKcal: null })) as ReportView["statistics"]["meals"],
        },
        summary: null, summaryError: null, markdown: "", stale: false, versions: [],
    };
    report.markdown = renderReportMarkdown(report);
    return report;
}

async function routerAt(path: string) {
    const router = createRouter({ history: createMemoryHistory(), routes: [
        { path: "/", component: { template: "<div />" } }, { path: "/reports", component: ReportsPage },
        { path: "/reports/:id", component: ReportPage }, { path: "/profile", component: { template: "<div />" } },
    ] });
    await router.push(path);
    await router.isReady();
    return router;
}

describe("五套固定报告模板", () => {
    it("不同周期渲染不同内容结构，缺失值与 Markdown 保持一致", () => {
        const cases = [
            [DailyReport, "daily", "当日能量参考"], [WeeklyReport, "weekly", "七天饮食与运动节奏"],
            [MonthlyReport, "monthly", "当月记录日历"], [YearlyReport, "yearly", "十二个月趋势与覆盖情况"],
            [CustomReport, "custom", "所选区间摄入与运动趋势"],
        ] as const;
        for (const [component, type, title] of cases) {
            const report = fixture(type);
            const wrapper = mount(component, { props: { report } });
            expect(wrapper.text()).toContain(title);
            expect(report.markdown).toContain(type === "custom" ? "所选区间摄入与运动趋势" : title);
            expect(wrapper.text()).toContain(type === "daily" ? "未知" : "未记录");
            if (type !== "daily") expect(wrapper.text()).not.toContain("当日能量参考");
            if (type === "monthly") expect(wrapper.findAll(".calendar-day")).toHaveLength(31);
            if (type === "yearly") expect(report.statistics.groups).toHaveLength(12);
            wrapper.unmount();
        }
    });

    it("图表使用与表格相同的统计值，缺失日期不连线或补零", () => {
        const stats = fixture("weekly").statistics;
        stats.days[0].intakeKcal = 190;
        stats.days[0].exerciseMinutes = 30;
        const intake = intakeChart(stats).series as { data: unknown[]; connectNulls: boolean }[];
        const exercise = exerciseChart(stats).series as { data: unknown[] }[];
        expect(intake[0].data).toEqual([190, null, null, null, null, null, null]);
        expect(intake[0].connectNulls).toBe(false);
        expect(exercise[0].data).toEqual([30, null, null, null, null, null, null]);
        const wrapper = mount(ReportMetrics, { props: { totals: stats.totals } });
        expect(wrapper.text()).toContain("0/7 天");
        expect(wrapper.text()).toContain("未记录");
    });
});

describe("报告页面与聊天链接", () => {
    it("详情显示过期提示、历史版本、总结失败和 Markdown 下载", async () => {
        const report = fixture();
        report.stale = true;
        report.summaryStatus = "failed";
        report.summaryError = "总结超时，统计已保存。";
        report.versions = [report, { ...report, id: "22345678-1234-1234-1234-123456789abc", version: 2 }];
        vi.spyOn(api, "getReport").mockResolvedValue(report);
        const router = await routerAt(`/reports/${report.id}`);
        const wrapper = mount(ReportPage, { global: { plugins: [router] } });
        await flushPromises();
        expect(wrapper.text()).toContain("当前显示已保存快照");
        expect(wrapper.text()).toContain("总结超时，统计已保存");
        expect(wrapper.get('a[download]').attributes("href")).toBe(`/api/reports/${report.id}/markdown`);
        expect(wrapper.findAll(".report-versions a")).toHaveLength(2);
        expect(wrapper.find("button").exists()).toBe(false);
    });

    it("报告列表筛选与分页并提供空数据状态", async () => {
        const report = fixture();
        const list = vi.spyOn(api, "listReports").mockResolvedValue({ reports: [report], total: 21, page: 1, pageSize: 20 });
        const router = await routerAt("/reports");
        const wrapper = mount(ReportsPage, { global: { plugins: [router] } });
        await flushPromises();
        expect(wrapper.findAll(".report-list-item")).toHaveLength(1);
        await wrapper.get("select").setValue("monthly");
        await wrapper.get('input[type="date"]').setValue("2025-01-01");
        await wrapper.get("form").trigger("submit");
        await flushPromises();
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ type: "monthly", fromDate: "2025-01-01", page: 1 }));
        await wrapper.findAll(".report-pagination button")[1].trigger("click");
        await flushPromises();
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
        list.mockResolvedValue({ reports: [], total: 0, page: 1, pageSize: 20 });
        await wrapper.get("form").trigger("submit");
        await flushPromises();
        expect(wrapper.text()).toContain("还没有符合条件的报告");
    });

    it("工具输出展示报告链接并拒绝任意地址", async () => {
        const router = await routerAt("/reports");
        const report = fixture();
        const wrapper = mount(ToolOutput, { props: { output: { summary: "报告已保存", reportUrl: `/reports/${report.id}` }, errorText: undefined }, global: { plugins: [router] } });
        expect(wrapper.get("a").attributes("href")).toBe(`/reports/${report.id}`);
        expect(wrapper.text()).toContain("查看报告");
        await wrapper.setProps({ output: { summary: "bad", reportUrl: "javascript:alert(1)" } });
        expect(wrapper.find("a").exists()).toBe(false);
    });
});
