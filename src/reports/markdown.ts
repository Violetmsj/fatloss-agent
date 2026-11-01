import { REPORT_TITLES, type NutritionStat, type SavedReport } from "./types.ts";

export function reportNumber(value: number | null, missing = "未记录"): string {
    return value === null ? missing : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

export function nutritionText(stat: NutritionStat): string {
    if (stat.totalG === null) return "未知";
    return `${reportNumber(stat.totalG)} 克${stat.knownEntries < stat.totalEntries ? "（已知部分合计）" : ""}`;
}

function escape(value: unknown): string {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: unknown[][]): string {
    return [headers, headers.map(() => "---"), ...rows].map((row) => `| ${row.map(escape).join(" | ")} |`).join("\n");
}

function overview(report: SavedReport): string {
    const t = report.statistics.totals;
    return `## 记录概况\n\n${table(["指标", "数值"], [
        ["统计日期天数", t.dayCount], ["饮食记录覆盖", `${t.foodDays}/${t.dayCount} 天（${reportNumber(t.foodCoveragePct)}%）`],
        ["运动记录覆盖", `${t.exerciseDays}/${t.dayCount} 天（${reportNumber(t.exerciseCoveragePct)}%）`],
        ["已记录摄入合计", `${reportNumber(t.intakeKcal)} 千卡`], ["饮食记录日日均摄入", `${reportNumber(t.averageIntakeKcal)} 千卡`],
        ["已记录运动时长", `${reportNumber(t.exerciseMinutes)} 分钟`], ["已记录运动消耗", `${reportNumber(t.exerciseKcal)} 千卡`],
        ["已知运动距离合计", `${reportNumber(t.exerciseDistanceKm, "未知")} 公里`],
    ])}`;
}

function meals(report: SavedReport): string {
    return `## 餐次热量分布\n\n${table(["餐次", "条目数", "已记录摄入（千卡）"], report.statistics.meals.map((meal) => [meal.mealType, meal.entries, reportNumber(meal.caloriesKcal)]))}`;
}

function nutrition(report: SavedReport): string {
    const labels = { proteinG: "蛋白质", carbsG: "碳水化合物", fatG: "脂肪", fiberG: "膳食纤维" } as const;
    return `## 营养素统计\n\n${table(["营养素", "数值", "已知条目/全部饮食条目"], Object.entries(labels).map(([key, label]) => {
        const stat = report.statistics.nutrition[key as keyof typeof labels];
        return [label, nutritionText(stat), `${stat.knownEntries}/${stat.totalEntries}`];
    }))}`;
}

function dailyTable(report: SavedReport, title: string): string {
    return `## ${title}\n\n${table(["日期", "饮食条目", "已记录摄入（千卡）", "摄入参考（千卡）", "摄入减参考（千卡）", "运动条目", "运动时长（分钟）", "运动消耗（千卡）"], report.statistics.days.map((day) => [
        day.date, day.foodEntries, reportNumber(day.intakeKcal), reportNumber(day.intakeTargetKcal, "未知"),
        reportNumber(day.intakeDifferenceKcal, "未知"), day.exerciseEntries, reportNumber(day.exerciseMinutes), reportNumber(day.exerciseKcal),
    ]))}`;
}

function groupTable(report: SavedReport, title: string): string {
    return `## ${title}\n\n${table(["区间", "饮食记录天数/天数", "运动记录天数/天数", "摄入合计（千卡）", "记录日日均摄入（千卡）", "对应记录日日均摄入参考（千卡）", "运动时长（分钟）", "运动消耗（千卡）"], report.statistics.groups.map((group) => [
        `${group.fromDate}～${group.toDate}`, `${group.foodDays}/${group.dayCount}`, `${group.exerciseDays}/${group.dayCount}`,
        reportNumber(group.intakeKcal), reportNumber(group.averageIntakeKcal), reportNumber(group.averageIntakeTargetKcal, "未知"),
        reportNumber(group.exerciseMinutes), reportNumber(group.exerciseKcal),
    ]))}`;
}

function exerciseTypes(report: SavedReport): string {
    return `## 运动种类分布\n\n${report.statistics.exercises.length ? table(["运动", "条目数", "时长（分钟）", "消耗（千卡）"], report.statistics.exercises.map((exercise) => [
        exercise.name, exercise.entries, reportNumber(exercise.minutes), reportNumber(exercise.caloriesKcal),
    ])) : "未记录运动；不代表没有运动。"}`;
}

function dailyTemplate(report: SavedReport): string[] {
    const day = report.statistics.days[0];
    const records = report.snapshot.records;
    const foods = records.flatMap((record) => record.foodEntries);
    const exercises = records.flatMap((record) => record.exerciseEntries);
    return [overview(report), `## 当日能量参考\n\n${table(["BMR 估算（千卡）", "TDEE 估算（千卡）", "摄入参考（千卡）", "已记录摄入减参考（千卡）"], [[
        reportNumber(day.bmrKcal, "未知"), reportNumber(day.tdeeKcal, "未知"), reportNumber(day.intakeTargetKcal, "未知"), reportNumber(day.intakeDifferenceKcal, "未知"),
    ]])}`, meals(report), nutrition(report),
    `## 饮食明细\n\n${foods.length ? table(["餐次", "食物", "分量", "热量（千卡）", "蛋白质（克）", "碳水（克）", "脂肪（克）", "纤维（克）", "来源/置信度", "备注"], foods.map((food) => [
        food.mealType, food.foodName, food.amount === null ? "未知" : `${reportNumber(food.amount)} ${food.unit}`,
        reportNumber(food.caloriesKcal), reportNumber(food.proteinG, "未知"), reportNumber(food.carbsG, "未知"), reportNumber(food.fatG, "未知"), reportNumber(food.fiberG, "未知"),
        `${food.calorieSourceType ?? "未知"}/${food.calorieConfidence ?? "未知"}`, food.note ?? "—",
    ])) : "未记录饮食。"}`,
    `## 运动明细\n\n${exercises.length ? table(["运动", "时长（分钟）", "消耗（千卡）", "距离（公里）", "强度", "来源/置信度", "备注"], exercises.map((exercise) => [
        exercise.exerciseName, reportNumber(exercise.durationMinutes), reportNumber(exercise.caloriesBurnedKcal), reportNumber(exercise.distanceKm, "未知"), exercise.intensity ?? "未知",
        `${exercise.calorieSourceType ?? "未知"}/${exercise.calorieConfidence ?? "未知"}`, exercise.note ?? "—",
    ])) : "未记录运动；不代表没有运动。"}`];
}

function weeklyTemplate(report: SavedReport): string[] {
    return [overview(report), dailyTable(report, "七天饮食与运动节奏"), meals(report), exerciseTypes(report)];
}

function monthlyTemplate(report: SavedReport): string[] {
    return [overview(report), `## 当月记录日历\n\n${table(["日期", "饮食", "运动"], report.statistics.days.map((day) => [day.date, day.foodEntries ? "已记录" : "未记录", day.exerciseEntries ? "已记录" : "未记录"]))}`,
        groupTable(report, "周间饮食与运动变化（边界周仅统计月内日期）"), nutrition(report), dailyTable(report, "当月每日摄入趋势与明细")];
}

function yearlyTemplate(report: SavedReport): string[] {
    return [overview(report), groupTable(report, "十二个月趋势与覆盖情况"), meals(report), exerciseTypes(report)];
}

function customTemplate(report: SavedReport): string[] {
    return [overview(report), `## 区间展示粒度\n\n按${{ day: "日", week: "自然周", month: "自然月" }[report.statistics.granularity]}汇总，边界分组仅包含所选范围内日期。`,
        groupTable(report, "所选区间摄入与运动趋势"), meals(report), exerciseTypes(report), nutrition(report)];
}

export function renderReportMarkdown(report: SavedReport): string {
    const templates = { daily: dailyTemplate, weekly: weeklyTemplate, monthly: monthlyTemplate, yearly: yearlyTemplate, custom: customTemplate };
    const summary = report.summary;
    const summaryText = summary ? [
        `### 概述\n\n${escape(summary.overview)}`,
        ...([["观察", summary.observations], ["数据局限", summary.limitations], ["下一阶段建议", summary.nextSteps]] as const)
            .map(([title, lines]) => `### ${title}\n\n${lines.length ? lines.map((line) => `- ${escape(line)}`).join("\n") : "无补充。"}`),
    ].join("\n\n") : report.summaryStatus === "not_applicable" ? "没有饮食或运动明细，未调用 AI。"
        : report.summaryStatus === "failed" ? "AI 总结未完成，统计已保存。可通过聊天明确重试生成该周期报告。" : "AI 总结尚未完成，统计已保存。";
    return [
        `# ${REPORT_TITLES[report.type]}`,
        `周期：${report.fromDate}～${report.toDate}｜统计至：${report.cutoffDate}｜版本：${report.version}\n\n生成时间：${report.createdAt}｜${report.ongoing ? "周期尚未结束，统计为截至生成时的记录。" : "周期已结束。"}`,
        ...templates[report.type](report), `## AI ${ { daily: "当日", weekly: "周度", monthly: "月度", yearly: "年度", custom: "区间" }[report.type]}总结\n\n${summaryText}`,
        "## 统计口径\n\n已记录摄入不代表完整摄入；未记录不等同于零。日均摄入仅以饮食记录日为分母。营养素缺失保持未知。能量参考采用历史快照，运动消耗单独展示，不叠加至 TDEE；本报告不判定达标率，不计算实际能量缺口或减重预测。",
    ].join("\n\n") + "\n";
}
