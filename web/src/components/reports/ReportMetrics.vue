<script setup lang="ts">
import { computed } from "vue";
import type { ReportTotals } from "../../../../src/reports/types.ts";
import { reportNumber } from "../../reports/presentation";

const props = defineProps<{ totals: ReportTotals }>();
const metrics = computed(() => [
    { label: "已记录摄入", value: reportNumber(props.totals.intakeKcal), unit: "千卡" },
    { label: "饮食记录日日均摄入", value: reportNumber(props.totals.averageIntakeKcal), unit: "千卡" },
    { label: "已记录运动时长", value: reportNumber(props.totals.exerciseMinutes), unit: "分钟" },
    { label: "已记录运动消耗", value: reportNumber(props.totals.exerciseKcal), unit: "千卡" },
]);
</script>

<template>
    <div class="report-metrics"><article v-for="metric in metrics" :key="metric.label" class="report-metric"><p>{{ metric.label }}</p><strong>{{ metric.value }}</strong><span>{{ metric.unit }}</span></article></div>
    <section class="report-coverage" aria-label="记录覆盖情况">
        <span>饮食记录 <b>{{ totals.foodDays }}/{{ totals.dayCount }} 天</b> · {{ reportNumber(totals.foodCoveragePct) }}%</span>
        <span>运动记录 <b>{{ totals.exerciseDays }}/{{ totals.dayCount }} 天</b> · {{ reportNumber(totals.exerciseCoveragePct) }}%</span>
        <span>缺失日期不计为零；已记录摄入不代表完整摄入。</span>
    </section>
</template>
