import type { ReportDay, ReportGroup } from "../../../src/reports/types.ts";
import { reportNumber } from "../../../src/reports/markdown.ts";

export { reportNumber, nutritionText } from "../../../src/reports/markdown.ts";
export { REPORT_TITLES, REPORT_TYPES } from "../../../src/reports/types.ts";

export const dailyHeaders = ["日期", "已记录摄入 / 千卡", "摄入参考 / 千卡", "摄入减参考 / 千卡", "运动时长 / 分钟", "运动消耗 / 千卡"];
export function dailyRows(days: ReportDay[]): string[][] {
    return days.map((day) => [day.date, reportNumber(day.intakeKcal), reportNumber(day.intakeTargetKcal, "未知"),
        reportNumber(day.intakeDifferenceKcal, "未知"), reportNumber(day.exerciseMinutes), reportNumber(day.exerciseKcal)]);
}

export const groupHeaders = ["区间", "饮食覆盖", "运动覆盖", "摄入合计 / 千卡", "记录日日均摄入 / 千卡", "有参考记录日日均参考 / 千卡", "运动时长 / 分钟", "运动消耗 / 千卡"];
export function groupRows(groups: ReportGroup[]): string[][] {
    return groups.map((group) => [group.fromDate === group.toDate ? group.fromDate : `${group.fromDate}～${group.toDate}`,
        `${group.foodDays}/${group.dayCount} 天`, `${group.exerciseDays}/${group.dayCount} 天`, reportNumber(group.intakeKcal),
        reportNumber(group.averageIntakeKcal), reportNumber(group.averageIntakeTargetKcal, "未知"),
        reportNumber(group.exerciseMinutes), reportNumber(group.exerciseKcal)]);
}

export const summaryLabels = { pending: "总结尚未完成", complete: "总结已保存", failed: "总结未完成，可重试", not_applicable: "空数据报告" };

export function localTime(value: string): string {
    return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
