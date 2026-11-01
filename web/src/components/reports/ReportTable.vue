<script setup lang="ts">
defineProps<{ title: string; headers: string[]; rows: (string | number)[][]; emptyText?: string }>();
</script>

<template>
    <section class="report-panel">
        <h2>{{ title }}</h2>
        <div v-if="rows.length" class="report-table-scroll" tabindex="0" :aria-label="title">
            <table><caption class="sr-only">{{ title }}</caption><thead><tr><th v-for="header in headers" :key="header" scope="col">{{ header }}</th></tr></thead>
                <tbody><tr v-for="(row, index) in rows" :key="index"><td v-for="(value, column) in row" :key="column">{{ value }}</td></tr></tbody>
            </table>
        </div>
        <p v-else class="report-muted">{{ emptyText || "未记录相关数据。" }}</p>
    </section>
</template>
