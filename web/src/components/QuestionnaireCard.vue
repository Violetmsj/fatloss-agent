<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import { parseQuestionnaireInput, questionnaireAnswerText } from "../questionnaire";
import { Button } from "./ui/button";

const props = defineProps<{ input: unknown; active: boolean; disabled?: boolean }>();
const emit = defineEmits<{ submit: [text: string]; cancel: [] }>();
const questions = computed(() => parseQuestionnaireInput(props.input));
const answers = reactive<Record<string, string>>({});
const custom = reactive<Record<string, string>>({});
const error = ref("");

function choose(id: string, value: string): void {
    answers[id] = value;
    error.value = "";
}

function submit(): void {
    // 自由输入先替换内部占位值，再统一生成一条可读的用户消息继续 Agent 会话。
    for (const question of questions.value) {
        if (answers[question.id] === "__other__") answers[question.id] = custom[question.id]?.trim() || "";
    }
    try {
        emit("submit", questionnaireAnswerText(questions.value, answers));
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "请回答全部问题";
    }
}
</script>

<template>
    <section class="questionnaire" :class="{ readonly: !active }">
        <header><strong>补充记录信息</strong><span>{{ active ? "等待回答" : "已结束" }}</span></header>
        <div v-for="question in questions" :key="question.id" class="question">
            <p><small v-if="question.label">{{ question.label }}</small>{{ question.prompt }}</p>
            <label v-for="option in question.options" :key="option.value" class="option">
                <input type="radio" :name="question.id" :value="option.value" :checked="answers[question.id] === option.value" :disabled="!active || disabled" @change="choose(question.id, option.value)">
                <span><b>{{ option.label }}</b><em v-if="option.description">{{ option.description }}</em></span>
            </label>
            <label v-if="question.allowOther" class="option other">
                <input type="radio" :name="question.id" value="__other__" :checked="answers[question.id] === '__other__'" :disabled="!active || disabled" @change="choose(question.id, '__other__')">
                <input v-model="custom[question.id]" type="text" placeholder="自由输入" :disabled="!active || disabled" @focus="choose(question.id, '__other__')">
            </label>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer v-if="active"><Button variant="outline" :disabled="disabled" @click="emit('cancel')">取消本次记录</Button><Button :disabled="disabled" @click="submit">提交答案</Button></footer>
    </section>
</template>

<style scoped>
.questionnaire { border: 1px solid color-mix(in oklch,var(--ink) 24%,transparent); background: color-mix(in oklch,var(--bone) 92%,white); padding: 1rem; display: grid; gap: .9rem; }
.questionnaire.readonly { opacity: .72; }
header,footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
header span,small { color: var(--muted-foreground); font: .68rem/1.2 var(--font-mono); }
.question { display: grid; gap: .45rem; }
.question p { margin: 0; font-weight: 600; }
.question small { display: block; margin-bottom: .2rem; text-transform: uppercase; }
.option { display: flex; align-items: flex-start; gap: .55rem; padding: .55rem .65rem; border: 1px solid color-mix(in oklch,var(--ink) 14%,transparent); cursor: pointer; }
.option span,.option b,.option em { display: block; }
.option b { font-size: .84rem; }
.option em { margin-top: .15rem; color: var(--muted-foreground); font-size: .75rem; font-style: normal; }
.other input[type="text"] { width: 100%; min-width: 0; border: 0; border-bottom: 1px solid currentColor; background: transparent; outline: none; }
footer { justify-content: flex-end; }
.error { color: var(--destructive); font-size: .78rem; }
</style>
