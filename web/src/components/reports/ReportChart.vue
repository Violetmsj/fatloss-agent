<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, use, type ECharts } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

use([BarChart, LineChart, PieChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
const props = defineProps<{ title: string; option: EChartsOption; empty?: boolean }>();
const element = ref<HTMLElement>();
let chart: ECharts | undefined;
let observer: ResizeObserver | undefined;
onMounted(() => {
    if (!element.value) return;
    chart = init(element.value, undefined, { renderer: "svg" });
    chart.setOption(props.option);
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(element.value);
});
watch(() => props.option, (option) => chart?.setOption(option, { notMerge: true }));
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<template>
    <section class="report-panel">
        <h2>{{ title }}</h2>
        <p v-if="empty" class="report-muted">未记录相关数据，图表为空。</p>
        <div ref="element" class="report-chart" role="img" :aria-label="`${title}，精确数值见下方数据表`" />
    </section>
</template>
