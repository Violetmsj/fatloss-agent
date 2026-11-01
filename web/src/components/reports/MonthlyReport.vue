<script setup lang="ts">
import { computed } from "vue";
import type { ReportView } from "../../../../src/reports/types.ts";
import { dailyHeaders, dailyRows, groupHeaders, groupRows } from "../../reports/presentation";
import ReportTrends from "./ReportTrends.vue";
import ReportNutrition from "./ReportNutrition.vue";
import ReportTable from "./ReportTable.vue";
const props = defineProps<{ report: ReportView }>();
const padding = computed(() => (new Date(`${props.report.fromDate}T00:00:00Z`).getUTCDay() + 6) % 7);
</script>
<template>
    <section class="report-panel">
        <h2>当月记录日历</h2><p class="report-muted">饮食与运动分别标记；空白表示未记录，不等同于零摄入或没有运动。</p>
        <div class="report-calendar"><span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday" class="calendar-weekday">{{ weekday }}</span>
            <span v-for="index in padding" :key="`pad-${index}`" />
            <div v-for="day in report.statistics.days" :key="day.date" class="calendar-day" :class="{ 'has-food': day.foodEntries > 0 }"><b>{{ Number(day.date.slice(-2)) }}</b><span>{{ day.foodEntries ? '饮食 ✓' : '饮食 —' }}</span><span>{{ day.exerciseEntries ? '运动 ✓' : '运动 —' }}</span></div>
        </div>
    </section>
    <ReportTrends :stats="report.statistics" />
    <ReportTable title="周间饮食与运动变化" :headers="groupHeaders" :rows="groupRows(report.statistics.groups)" />
    <p class="report-muted">边界周仅统计本月内日期，各周的记录覆盖可能不同。</p>
    <ReportNutrition :stats="report.statistics" />
    <ReportTable title="当月每日摄入趋势与明细" :headers="dailyHeaders" :rows="dailyRows(report.statistics.days)" />
</template>
