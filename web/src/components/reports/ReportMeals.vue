<script setup lang="ts">
import type { ReportStatistics } from "../../../../src/reports/types.ts";
import { mealChart } from "../../reports/charts";
import { reportNumber } from "../../reports/presentation";
import ReportChart from "./ReportChart.vue";
import ReportTable from "./ReportTable.vue";
defineProps<{ stats: ReportStatistics }>();
</script>
<template>
    <div class="report-grid">
        <ReportChart title="餐次热量分布" :option="mealChart(stats)" :empty="stats.totals.foodDays === 0" />
        <ReportTable title="餐次分布数据" :headers="['餐次', '条目数', '已记录摄入 / 千卡']" :rows="stats.meals.map(meal => [meal.mealType, meal.entries, reportNumber(meal.caloriesKcal)])" />
    </div>
</template>
