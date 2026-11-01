<script setup lang="ts">
import { computed } from "vue";
import type { ReportStatistics } from "../../../../src/reports/types.ts";
import { nutritionText } from "../../reports/presentation";
import ReportTable from "./ReportTable.vue";
const props = defineProps<{ stats: ReportStatistics }>();
const labels = { proteinG: "蛋白质", carbsG: "碳水化合物", fatG: "脂肪", fiberG: "膳食纤维" } as const;
const rows = computed(() => Object.entries(labels).map(([key, label]) => {
    const stat = props.stats.nutrition[key as keyof typeof labels];
    return [label, nutritionText(stat), `${stat.knownEntries}/${stat.totalEntries} 条`];
}));
</script>
<template><ReportTable title="营养素统计" :headers="['营养素', '数值', '已知条目 / 全部饮食条目']" :rows="rows" /></template>
