import type { EChartsOption } from "echarts";
import type { ReportStatistics } from "../../../src/reports/types.ts";

const base: EChartsOption = {
    color: ["#618d32", "#3d8563", "#d57662"], animation: false,
    textStyle: { fontFamily: "PingFang SC, sans-serif", color: "#52594f" },
    tooltip: { trigger: "axis", renderMode: "richText" }, legend: { top: 0 },
    grid: { left: 65, right: 24, top: 48, bottom: 65 }, aria: { enabled: true },
};

export function intakeChart(stats: ReportStatistics, grouped = false): EChartsOption {
    const rows = grouped ? stats.groups : stats.days;
    return {
        ...base, xAxis: { type: "category", data: rows.map((row) => "label" in row ? row.label : row.date), axisLabel: { rotate: 35 } },
        yAxis: { type: "value", name: "千卡" },
        series: [
            { name: grouped ? "记录日日均摄入" : "已记录摄入", type: "line", connectNulls: false,
                data: rows.map((row) => "averageIntakeKcal" in row ? row.averageIntakeKcal : row.intakeKcal) },
            { name: grouped ? "有参考记录日日均参考" : "历史摄入参考", type: "line", connectNulls: false, lineStyle: { type: "dashed" },
                data: rows.map((row) => "averageIntakeTargetKcal" in row ? row.averageIntakeTargetKcal : row.intakeTargetKcal) },
        ],
    };
}

export function exerciseChart(stats: ReportStatistics, grouped = false): EChartsOption {
    const rows = grouped ? stats.groups : stats.days;
    return {
        ...base, xAxis: { type: "category", data: rows.map((row) => "label" in row ? row.label : row.date), axisLabel: { rotate: 35 } },
        yAxis: [{ type: "value", name: "分钟" }, { type: "value", name: "千卡" }],
        series: [
            { name: "已记录运动时长", type: "bar", data: rows.map((row) => row.exerciseMinutes) },
            { name: "已记录运动消耗", type: "line", yAxisIndex: 1, connectNulls: false, data: rows.map((row) => row.exerciseKcal) },
        ],
    };
}

export function mealChart(stats: ReportStatistics): EChartsOption {
    return {
        ...base, tooltip: { trigger: "item", renderMode: "richText" },
        series: [{ type: "pie", radius: ["42%", "65%"], top: 30,
            data: stats.meals.filter((meal) => meal.entries > 0).map((meal) => ({ name: meal.mealType, value: meal.caloriesKcal! })) }],
    };
}
