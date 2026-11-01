<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type ReportList, type ReportType } from "../api";
import { REPORT_TITLES, REPORT_TYPES, localTime, summaryLabels } from "../reports/presentation";
import "../reports/reports.css";

const data = ref<ReportList | null>(null);
const type = ref<ReportType | "">("");
const fromDate = ref("");
const toDate = ref("");
const page = ref(1);
const loading = ref(false);
const error = ref("");
async function load(reset = false): Promise<void> {
    if (reset) page.value = 1;
    loading.value = true;
    error.value = "";
    try { data.value = await api.listReports({ type: type.value || undefined, fromDate: fromDate.value || undefined, toDate: toDate.value || undefined, page: page.value }); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "加载报告失败。"; }
    finally { loading.value = false; }
}
async function changePage(delta: number): Promise<void> { page.value += delta; await load(); }
onMounted(() => load());
</script>

<template>
    <main class="report-page">
        <nav class="report-nav"><RouterLink to="/">返回聊天</RouterLink><RouterLink to="/profile">个人画像</RouterLink></nav>
        <header class="report-heading"><span class="report-eyebrow">减脂陪伴 / 记录回顾</span><h1>减脂报告</h1><p>在聊天中说“生成今天的日报”或“生成上个月的月报”，报告会保存在这里。</p></header>
        <form class="report-filters" @submit.prevent="load(true)">
            <label>报告类型<select v-model="type"><option value="">全部类型</option><option v-for="item in REPORT_TYPES" :key="item" :value="item">{{ REPORT_TITLES[item] }}</option></select></label>
            <label>开始日期<input v-model="fromDate" type="date"></label><label>结束日期<input v-model="toDate" type="date"></label>
            <button type="submit" class="report-button" :disabled="loading">筛选</button>
        </form>
        <p v-if="error" role="alert" class="report-error">{{ error }}</p>
        <p v-if="loading" role="status" class="report-muted">正在加载报告…</p>
        <template v-else-if="data && !error">
            <section v-if="!data.reports.length" class="report-panel"><h2>还没有符合条件的报告</h2><p class="report-muted">通过聊天按需生成日报、周报、月报、年报或自定义日期报告。</p></section>
            <div v-else class="report-list">
                <RouterLink v-for="report in data.reports" :key="report.id" :to="`/reports/${report.id}`" class="report-list-item">
                    <span class="report-eyebrow">{{ REPORT_TITLES[report.type] }} · V{{ report.version }}</span><h2>{{ report.fromDate }}～{{ report.toDate }}</h2>
                    <p>统计至 {{ report.cutoffDate }}{{ report.ongoing ? ' · 周期尚未结束' : '' }}</p>
                    <footer><span>{{ summaryLabels[report.summaryStatus] }}</span><time>{{ localTime(report.createdAt) }}</time></footer>
                </RouterLink>
            </div>
            <nav class="report-pagination" aria-label="报告分页"><button class="report-button" :disabled="page <= 1" @click="changePage(-1)">上一页</button><span>第 {{ page }} 页 · 共 {{ data.total }} 份</span><button class="report-button" :disabled="page * data.pageSize >= data.total" @click="changePage(1)">下一页</button></nav>
        </template>
    </main>
</template>
