<script setup lang="ts">
import { computed } from "vue";
import type { ReportView } from "../../../../src/reports/types.ts";
import { reportNumber } from "../../reports/presentation";
import ReportMeals from "./ReportMeals.vue";
import ReportNutrition from "./ReportNutrition.vue";
import ReportTable from "./ReportTable.vue";
const props = defineProps<{ report: ReportView }>();
const day = computed(() => props.report.statistics.days[0]);
const foods = computed(() => props.report.snapshot.records.flatMap(record => record.foodEntries));
const exercises = computed(() => props.report.snapshot.records.flatMap(record => record.exerciseEntries));
</script>

<template>
    <ReportTable title="当日能量参考" :headers="['BMR 估算 / 千卡', 'TDEE 估算 / 千卡', '摄入参考 / 千卡', '已记录摄入减参考 / 千卡']" :rows="[[reportNumber(day.bmrKcal, '未知'), reportNumber(day.tdeeKcal, '未知'), reportNumber(day.intakeTargetKcal, '未知'), reportNumber(day.intakeDifferenceKcal, '未知')]]" />
    <ReportMeals :stats="report.statistics" />
    <ReportNutrition :stats="report.statistics" />
    <ReportTable title="饮食明细" :headers="['餐次', '食物', '分量', '热量 / 千卡', '蛋白质 / 克', '碳水 / 克', '脂肪 / 克', '纤维 / 克', '来源 / 置信度', '备注']" :rows="foods.map(food => [food.mealType, food.foodName, food.amount === null ? '未知' : `${reportNumber(food.amount)} ${food.unit}`, reportNumber(food.caloriesKcal), reportNumber(food.proteinG, '未知'), reportNumber(food.carbsG, '未知'), reportNumber(food.fatG, '未知'), reportNumber(food.fiberG, '未知'), `${food.calorieSourceType ?? '未知'}/${food.calorieConfidence ?? '未知'}`, food.note ?? '—'])" />
    <ReportTable title="运动明细" :headers="['运动', '时长 / 分钟', '消耗 / 千卡', '距离 / 公里', '强度', '来源 / 置信度', '备注']" :rows="exercises.map(item => [item.exerciseName, reportNumber(item.durationMinutes), reportNumber(item.caloriesBurnedKcal), reportNumber(item.distanceKm, '未知'), item.intensity ?? '未知', `${item.calorieSourceType ?? '未知'}/${item.calorieConfidence ?? '未知'}`, item.note ?? '—'])" empty-text="未记录运动；不代表没有运动。" />
</template>
