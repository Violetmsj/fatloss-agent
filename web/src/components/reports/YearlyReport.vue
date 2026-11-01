<script setup lang="ts">
import type { ReportView } from "../../../../src/reports/types.ts";
import { groupHeaders, groupRows } from "../../reports/presentation";
import ReportTrends from "./ReportTrends.vue";
import ReportMeals from "./ReportMeals.vue";
import ReportExerciseTypes from "./ReportExerciseTypes.vue";
import ReportTable from "./ReportTable.vue";
defineProps<{ report: ReportView }>();
</script>
<template>
    <section class="report-panel"><h2>年度回顾 · 月度趋势</h2><p class="report-muted">按自然月展示饮食与运动。当前年份仅包含截至统计日期的月份，月均值仅依据有记录日期。</p></section>
    <ReportTrends :stats="report.statistics" grouped />
    <ReportTable title="十二个月趋势与覆盖情况" :headers="groupHeaders" :rows="groupRows(report.statistics.groups)" />
    <ReportMeals :stats="report.statistics" />
    <ReportExerciseTypes :stats="report.statistics" />
</template>
