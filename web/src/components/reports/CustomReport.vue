<script setup lang="ts">
import type { ReportView } from "../../../../src/reports/types.ts";
import { groupHeaders, groupRows } from "../../reports/presentation";
import ReportTrends from "./ReportTrends.vue";
import ReportMeals from "./ReportMeals.vue";
import ReportNutrition from "./ReportNutrition.vue";
import ReportExerciseTypes from "./ReportExerciseTypes.vue";
import ReportTable from "./ReportTable.vue";
defineProps<{ report: ReportView }>();
</script>
<template>
    <section class="report-panel"><h2>所选区间 · {{ report.fromDate }}～{{ report.toDate }}</h2><p class="report-muted">按{{ { day: '日', week: '自然周', month: '自然月' }[report.statistics.granularity] }}汇总，边界分组仅包含所选范围内日期。</p></section>
    <ReportTrends :stats="report.statistics" grouped />
    <ReportTable title="所选区间摄入与运动趋势" :headers="groupHeaders" :rows="groupRows(report.statistics.groups)" />
    <ReportMeals :stats="report.statistics" />
    <ReportExerciseTypes :stats="report.statistics" />
    <ReportNutrition :stats="report.statistics" />
</template>
