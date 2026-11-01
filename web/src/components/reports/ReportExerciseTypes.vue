<script setup lang="ts">
import type { ReportStatistics } from "../../../../src/reports/types.ts";
import { reportNumber } from "../../reports/presentation";
import ReportTable from "./ReportTable.vue";
defineProps<{ stats: ReportStatistics }>();
</script>
<template><ReportTable title="运动种类分布" :headers="['运动', '条目数', '时长 / 分钟', '消耗 / 千卡']" :rows="stats.exercises.map(item => [item.name, item.entries, reportNumber(item.minutes), reportNumber(item.caloriesKcal)])" empty-text="未记录运动；不代表没有运动。" /></template>
