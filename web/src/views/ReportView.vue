<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, type ReportView } from "../api";
import { REPORT_TITLES, localTime } from "../reports/presentation";
import DailyReport from "../components/reports/DailyReport.vue";
import WeeklyReport from "../components/reports/WeeklyReport.vue";
import MonthlyReport from "../components/reports/MonthlyReport.vue";
import YearlyReport from "../components/reports/YearlyReport.vue";
import CustomReport from "../components/reports/CustomReport.vue";
import ReportMetrics from "../components/reports/ReportMetrics.vue";
import "../reports/reports.css";

const route = useRoute();
const report = ref<ReportView | null>(null);
const error = ref("");
const templates = { daily: DailyReport, weekly: WeeklyReport, monthly: MonthlyReport, yearly: YearlyReport, custom: CustomReport };
onMounted(async () => {
    try { report.value = await api.getReport(String(route.params.id)); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "加载报告失败。"; }
});
</script>

<template>
    <main class="report-page">
        <nav class="report-nav"><RouterLink to="/reports">所有报告</RouterLink><RouterLink to="/">返回聊天</RouterLink></nav>
        <p v-if="error" role="alert" class="report-error">{{ error }}</p><p v-else-if="!report" role="status" class="report-muted">正在加载报告…</p>
        <template v-else>
            <header class="report-heading"><span class="report-eyebrow">{{ REPORT_TITLES[report.type] }} · V{{ report.version }}</span><h1>{{ report.fromDate }}<span v-if="report.fromDate !== report.toDate">～{{ report.toDate }}</span></h1><p>统计至 {{ report.cutoffDate }} · 生成于 {{ localTime(report.createdAt) }}</p></header>
            <div class="report-actions"><a class="report-button" :href="`/api/reports/${encodeURIComponent(report.id)}/markdown`" download>下载 Markdown</a>
                <span v-if="report.ongoing" class="report-pill">周期尚未结束</span>
            </div>
            <aside v-if="report.stale" class="report-notice" role="status">源记录或周期进度已变化。当前显示已保存快照；可在聊天中明确要求更新此周期报告，旧版会保留。</aside>
            <nav v-if="report.versions.length > 1" class="report-versions" aria-label="历史版本">版本：<RouterLink v-for="version in report.versions" :key="version.id" :to="`/reports/${version.id}`" :aria-current="version.id === report.id ? 'page' : undefined">V{{ version.version }}</RouterLink></nav>
            <ReportMetrics :totals="report.statistics.totals" />
            <component :is="templates[report.type]" :report="report" />
            <section class="report-panel report-summary"><span class="report-eyebrow">AI 总结 · {{ report.model || '未调用模型' }}</span><h2>{{ { daily: '当日', weekly: '周度', monthly: '月度', yearly: '年度', custom: '区间' }[report.type] }}总结</h2>
                <template v-if="report.summary"><h3>概述</h3><p>{{ report.summary.overview }}</p>
                    <template v-for="section in [{ title: '观察', lines: report.summary.observations }, { title: '数据局限', lines: report.summary.limitations }, { title: '下一阶段建议', lines: report.summary.nextSteps }]" :key="section.title"><h3>{{ section.title }}</h3><ul v-if="section.lines.length"><li v-for="line in section.lines" :key="line">{{ line }}</li></ul><p v-else>无补充。</p></template>
                </template>
                <p v-else-if="report.summaryStatus === 'not_applicable'">没有饮食或运动明细，未调用 AI。</p>
                <p v-else>{{ report.summaryError || 'AI 总结尚未完成，统计已保存。' }} 可通过聊天明确重试生成此周期报告。</p>
            </section>
            <section class="report-panel"><h2>统计口径</h2><p class="report-muted">已记录摄入不代表完整摄入，未记录不等同于零。日均摄入以饮食记录日为分母。营养素缺失保持未知。能量参考采用历史快照，运动消耗不叠加至 TDEE；不判定达标率，不计算实际能量缺口或减重预测。当前数据没有身体指标历史，未展示体重与体脂变化。</p></section>
        </template>
    </main>
</template>
