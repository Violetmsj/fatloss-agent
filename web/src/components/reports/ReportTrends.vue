<script setup lang="ts">
import type { ReportStatistics } from "../../../../src/reports/types.ts";
import { exerciseChart, intakeChart } from "../../reports/charts";
import ReportChart from "./ReportChart.vue";
defineProps<{ stats: ReportStatistics; grouped?: boolean }>();
</script>
<template>
    <div class="report-grid">
        <ReportChart :title="grouped ? '分组摄入变化' : '每日摄入与参考趋势'" :option="intakeChart(stats, grouped)" :empty="stats.totals.foodDays === 0" />
        <ReportChart :title="grouped ? '分组运动变化' : '每日运动节奏'" :option="exerciseChart(stats, grouped)" :empty="stats.totals.exerciseDays === 0" />
    </div>
</template>
