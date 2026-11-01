<script setup lang="ts">
import type { ReportView } from "../../../../src/reports/types.ts";
import { dailyHeaders, dailyRows } from "../../reports/presentation";
import ReportTrends from "./ReportTrends.vue";
import ReportMeals from "./ReportMeals.vue";
import ReportExerciseTypes from "./ReportExerciseTypes.vue";
import ReportTable from "./ReportTable.vue";
defineProps<{ report: ReportView }>();
</script>
<template>
    <ReportTrends :stats="report.statistics" />
    <ReportTable title="七天饮食与运动节奏" :headers="dailyHeaders" :rows="dailyRows(report.statistics.days)" />
    <ReportMeals :stats="report.statistics" />
    <ReportExerciseTypes :stats="report.statistics" />
</template>
