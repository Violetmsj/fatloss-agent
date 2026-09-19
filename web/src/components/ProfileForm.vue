<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import { api, ApiError, type Profile, type ProfileFormDefinition, type ProfileInput, type ProfilePreview } from "../api";
import { validateProfileForm, type ProfileErrors } from "../profile-validation";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

const props = defineProps<{
    definition: ProfileFormDefinition;
    initialProfile?: ProfileInput | Profile | null;
    submitLabel?: string;
}>();
const emit = defineEmits<{ saved: [profile: Profile] }>();

const emptyProfile = (): ProfileInput => ({
    gender: "",
    age: 30,
    weightKg: 70,
    heightCm: 170,
    bodyFatPct: 25,
    waistCm: 80,
    hipCm: null,
    goal: "减脂",
    targetBodyFatPct: 20,
    dailyEnergyDeficitKcal: 500,
    dietExercisePreference: "",
    activityLevel: "",
    jobType: "",
    favoriteExercises: [],
    equipment: [],
    stairResponse: "",
    focusArea: "全身",
    trainingDays: [],
});

// Vue reactive 对象不能直接 structuredClone；显式复制三个数组也避免修改父组件传入值。
function copyProfile(profile: ProfileInput | Profile): ProfileInput {
    return {
        ...profile,
        activityLevel: profile.activityLevel ?? "",
        favoriteExercises: [...profile.favoriteExercises],
        equipment: [...profile.equipment],
        trainingDays: [...profile.trainingDays],
    };
}
const form = reactive<ProfileInput>(copyProfile(props.initialProfile ?? emptyProfile()));
const errors = ref<ProfileErrors>({});
const serverError = ref("");
const loading = ref(false);
const preview = ref<ProfilePreview | null>(null);
const showPreview = computed({ get: () => preview.value !== null, set: (open) => { if (!open) preview.value = null; } });

function toggle(field: "favoriteExercises" | "equipment" | "trainingDays", value: string): void {
    const selected = form[field];
    const index = selected.indexOf(value);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(value);
    // “不使用器械”与具体器械互斥，在点击时立即修正，服务端保存前仍会再次校验。
    if (field === "equipment" && props.definition.constraints.equipment.exclusive) {
        const exclusive = props.definition.constraints.equipment.exclusive;
        if (value === exclusive && selected.includes(value)) form.equipment = [exclusive];
        else if (value !== exclusive) form.equipment = form.equipment.filter((item) => item !== exclusive);
    }
}

async function submitPreview(): Promise<void> {
    serverError.value = "";
    errors.value = validateProfileForm(form, props.definition);
    if (Object.keys(errors.value).length > 0) {
        document.querySelector("[aria-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    loading.value = true;
    try {
        // preview 只做后端校验和估算，不会写入 SQLite。
        preview.value = await api.previewProfile(copyProfile(form));
    } catch (error) {
        serverError.value = error instanceof ApiError ? error.message : "预览失败，请稍后重试。";
    } finally {
        loading.value = false;
    }
}

async function confirmSave(): Promise<void> {
    loading.value = true;
    serverError.value = "";
    try {
        // 用户在弹窗确认后才真正覆盖画像；后端会重复同一套业务校验。
        const result = await api.saveProfile(copyProfile(form));
        preview.value = null;
        emit("saved", result.profile);
    } catch (error) {
        serverError.value = error instanceof ApiError ? error.message : "保存失败，请稍后重试。";
        preview.value = null;
    } finally {
        loading.value = false;
    }
}

const numberFields = [
    { key: "age", index: "02", label: "年龄", unit: "岁", step: 1 },
    { key: "heightCm", index: "03", label: "身高", unit: "cm", step: 0.1 },
    { key: "weightKg", index: "04", label: "体重", unit: "kg", step: 0.1 },
    { key: "bodyFatPct", index: "05", label: "体脂率", unit: "%", step: 0.1 },
    { key: "waistCm", index: "06", label: "腰围", unit: "cm", step: 0.1 },
    { key: "hipCm", index: "07", label: "臀围（选填）", unit: "cm", step: 0.1 },
] as const;
</script>

<template>
    <form class="profile-form" @submit.prevent="submitPreview">
        <section class="form-section">
            <header><span>01</span><div><h2>基础身体信息</h2><p>用于计算目标体重与减脂周期。</p></div></header>
            <div class="field-grid">
                <fieldset class="field span-2" :aria-invalid="!!errors.gender">
                    <legend>性别</legend>
                    <div class="choice-row"><label v-for="option in definition.options.genders" :key="option" class="choice"><input v-model="form.gender" type="radio" :value="option"><span>{{ option }}</span></label></div>
                    <small v-if="errors.gender" class="error">{{ errors.gender }}</small>
                </fieldset>
                <label v-for="field in numberFields" :key="field.key" class="field">
                    <span>{{ field.label }}</span>
                    <div class="input-with-unit"><input v-if="field.key !== 'hipCm'" v-model.number="form[field.key]" type="number" :step="field.step" :min="definition.constraints[field.key].minimum" :max="definition.constraints[field.key].maximum" :aria-invalid="!!errors[field.key]"><input v-else :value="form.hipCm ?? ''" type="number" :step="field.step" :min="definition.constraints.hipCm.minimum" :max="definition.constraints.hipCm.maximum" :aria-invalid="!!errors.hipCm" @input="form.hipCm = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"><b>{{ field.unit }}</b></div>
                    <small v-if="errors[field.key]" class="error">{{ errors[field.key] }}</small>
                </label>
            </div>
        </section>

        <section class="form-section">
            <header><span>02</span><div><h2>减脂目标</h2><p>提交前会先展示估算结果，不会直接保存。</p></div></header>
            <div class="field-grid">
                <label class="field"><span>计划目标</span><select v-model="form.goal" :aria-invalid="!!errors.goal"><option v-for="option in definition.options.goals" :key="option">{{ option }}</option></select><small v-if="errors.goal" class="error">{{ errors.goal }}</small></label>
                <label class="field"><span>目标体脂率</span><div class="input-with-unit"><input v-model.number="form.targetBodyFatPct" type="number" step="0.1" :min="definition.constraints.targetBodyFatPct.minimum" :max="form.bodyFatPct" :aria-invalid="!!errors.targetBodyFatPct"><b>%</b></div><small v-if="errors.targetBodyFatPct" class="error">{{ errors.targetBodyFatPct }}</small></label>
                <label class="field span-2"><span>每日总能量缺口</span><div class="input-with-unit"><input v-model.number="form.dailyEnergyDeficitKcal" type="number" step="1" :min="definition.constraints.dailyEnergyDeficitKcal.minimum" :max="definition.constraints.dailyEnergyDeficitKcal.maximum" :aria-invalid="!!errors.dailyEnergyDeficitKcal"><b>千卡</b></div><small>建议从温和缺口开始，后续结合真实体重变化调整。</small><small v-if="errors.dailyEnergyDeficitKcal" class="error">{{ errors.dailyEnergyDeficitKcal }}</small></label>
            </div>
        </section>

        <section class="form-section">
            <header><span>03</span><div><h2>生活方式</h2><p>让建议更贴近你的日常节奏。</p></div></header>
            <div class="field-grid">
                <label class="field"><span>吃动偏好</span><select v-model="form.dietExercisePreference" :aria-invalid="!!errors.dietExercisePreference"><option disabled value="">请选择</option><option v-for="option in definition.options.dietExercisePreferences" :key="option">{{ option }}</option></select><small v-if="errors.dietExercisePreference" class="error">{{ errors.dietExercisePreference }}</small></label>
                <label class="field"><span>活动水平</span><select v-model="form.activityLevel" :aria-invalid="!!errors.activityLevel"><option disabled value="">请选择</option><option v-for="option in definition.options.activityLevels" :key="option.value" :value="option.value">{{ option.value }}（{{ option.description }}）× {{ option.factor }}</option></select><small>请选择当前活动水平，不是未来计划的训练频次。{{ initialProfile?.activityLevel === null ? "原画像的活动水平待补充。" : "" }}</small><small v-if="errors.activityLevel" class="error">{{ errors.activityLevel }}</small></label>
                <label class="field"><span>工作类型</span><select v-model="form.jobType" :aria-invalid="!!errors.jobType"><option disabled value="">请选择</option><option v-for="option in definition.options.jobTypes" :key="option">{{ option }}</option></select><small v-if="errors.jobType" class="error">{{ errors.jobType }}</small></label>
                <label class="field"><span>连续爬五层楼的反应</span><select v-model="form.stairResponse" :aria-invalid="!!errors.stairResponse"><option disabled value="">请选择</option><option v-for="option in definition.options.stairResponses" :key="option">{{ option }}</option></select><small v-if="errors.stairResponse" class="error">{{ errors.stairResponse }}</small></label>
            </div>
        </section>

        <section class="form-section">
            <header><span>04</span><div><h2>训练偏好</h2><p>选择你更愿意长期坚持的方式。</p></div></header>
            <div class="field-stack">
                <fieldset class="field" :aria-invalid="!!errors.favoriteExercises"><legend>喜欢的运动（最多 2 项）</legend><div class="choice-row wrap"><label v-for="option in definition.options.exercises" :key="option" class="choice"><input :checked="form.favoriteExercises.includes(option)" type="checkbox" @change="toggle('favoriteExercises', option)"><span>{{ option }}</span></label></div><small v-if="errors.favoriteExercises" class="error">{{ errors.favoriteExercises }}</small></fieldset>
                <fieldset class="field" :aria-invalid="!!errors.equipment"><legend>可用器械</legend><div class="choice-row wrap"><label v-for="option in definition.options.equipment" :key="option" class="choice"><input :checked="form.equipment.includes(option)" type="checkbox" @change="toggle('equipment', option)"><span>{{ option }}</span></label></div><small v-if="errors.equipment" class="error">{{ errors.equipment }}</small></fieldset>
                <fieldset class="field" :aria-invalid="!!errors.trainingDays"><legend>每周训练日（3 至 7 天）</legend><div class="choice-row wrap"><label v-for="option in definition.options.trainingDays" :key="option" class="choice day"><input :checked="form.trainingDays.includes(option)" type="checkbox" @change="toggle('trainingDays', option)"><span>周{{ option }}</span></label></div><small v-if="errors.trainingDays" class="error">{{ errors.trainingDays }}</small></fieldset>
                <label class="field"><span>重点改善部位</span><select v-model="form.focusArea" :aria-invalid="!!errors.focusArea"><option v-for="option in definition.options.focusAreas" :key="option">{{ option }}</option></select><small v-if="errors.focusArea" class="error">{{ errors.focusArea }}</small></label>
            </div>
        </section>

        <p v-if="serverError" class="server-error" role="alert">{{ serverError }}</p>
        <div class="form-actions"><Button size="lg" type="submit" :disabled="loading">{{ loading ? "正在校验…" : (submitLabel ?? "预览画像") }}</Button></div>
    </form>

    <Dialog v-model:open="showPreview">
        <DialogContent class="profile-dialog" :show-close-button="false">
            <DialogHeader><span class="dialog-eyebrow">Calibration output / 校准结果</span><DialogTitle>确认你的减脂画像</DialogTitle><DialogDescription>以下是静态热量换算的粗略估计，仅供制定计划参考。</DialogDescription></DialogHeader>
            <div v-if="preview" class="preview-card">
                <div class="estimate-grid"><div><strong>{{ preview.estimate.targetWeightKg.toFixed(1) }}</strong><span>目标体重 kg</span></div><div><strong>{{ preview.estimate.fatLossKg.toFixed(1) }}</strong><span>预计减重 kg</span></div><div><strong>{{ preview.estimate.estimatedWeeks }}</strong><span>预计周数</span></div><div><strong>{{ preview.estimate.speed }}</strong><span>速度</span></div></div>
                <pre>{{ preview.summary }}</pre>
            </div>
            <DialogFooter><span class="dialog-note">保存前可随时返回修改</span><Button variant="outline" :disabled="loading" @click="preview = null">返回修改</Button><Button :disabled="loading" @click="confirmSave">{{ loading ? "正在保存…" : "确认并保存" }}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<style scoped>
.profile-form { display: grid; counter-reset: profile-field; }
.form-section { padding-top: .5rem; }
.form-section header { display: grid; grid-template-columns: 6.5rem minmax(0,1fr); gap: 1.4rem; align-items: start; margin-top: 2.1rem; padding: 1.6rem 0 1.45rem; border-top: 1px solid var(--ink); }
.form-section:first-child header { margin-top: 1.6rem; }
.form-section header > span { color: var(--ink); font: 400 2.6rem/1 var(--font-mono); letter-spacing: -.04em; }
.form-section h2 { margin: 0; font: 600 1.2rem/1.25 var(--font-display); letter-spacing: -.01em; }
.form-section header p { margin: .45rem 0 0; color: var(--graphite); font-size: .8rem; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.4rem 1.9rem; }
.field-stack { display: grid; gap: 1.4rem; }
.span-2 { grid-column: 1 / -1; }
.field { min-width: 0; display: grid; gap: .5rem; margin: 0; padding: 0; border: 0; }
.field > span,.field legend { display: flex; align-items: center; gap: .5rem; color: var(--ink); font-size: .8rem; font-weight: 450; }
.field > span::before,.field legend::before { counter-increment: profile-field; content: counter(profile-field, decimal-leading-zero); color: var(--graphite); font: .65rem/1 var(--font-mono); }
.field small { color: var(--graphite); font-size: .75rem; line-height: 1.6; }
input[type="number"], select { width: 100%; min-height: 2.9rem; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); padding: 0 .9rem; color: var(--ink); outline: none; font-variant-numeric: tabular-nums; transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
input[type="number"]:hover,select:hover { border-color: var(--hairline-2); }
input[type="number"]:focus,select:focus { border-color: var(--lime-ink); box-shadow: 0 0 0 3px var(--lime-soft); }
[aria-invalid="true"] input,[aria-invalid="true"] select,input[aria-invalid="true"],select[aria-invalid="true"] { border-color: var(--red-ink); background: color-mix(in oklch,var(--red) 7%,var(--surface)); box-shadow: 0 0 0 3px var(--red-soft); }
.input-with-unit { position: relative; display: flex; align-items: stretch; }
.input-with-unit input { padding-right: 4rem; }
.input-with-unit b { position: absolute; inset: 1px 1px 1px auto; min-width: 3.4rem; display: grid; place-items: center; border-left: 1px solid var(--hairline); color: var(--graphite); font: 400 .68rem/1 var(--font-mono); }
.choice-row { display: flex; gap: .6rem; }
.wrap { flex-wrap: wrap; }
.choice { position: relative; }
.choice input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.choice span { position: relative; min-height: 2.75rem; display: inline-flex; align-items: center; gap: .55rem; padding: 0 1rem; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); color: var(--ink); cursor: pointer; user-select: none; font-size: .86rem; transition: background .18s ease,border-color .18s ease,color .18s ease; }
.choice span::before { content: ""; width: .9rem; height: .9rem; flex: none; border: 1px solid var(--hairline-2); border-radius: 3px; }
.choice input[type="radio"] + span::before { border-radius: 50%; }
.choice:hover span { border-color: var(--hairline-2); background: color-mix(in oklch,var(--ink) 4%,var(--surface)); }
.choice input:focus-visible + span { outline: 2px solid var(--lime-ink); outline-offset: 2px; }
.choice input:checked + span { border-color: var(--ink); background: var(--ink); color: var(--bone); font-weight: 600; }
.choice input:checked + span::before { content: "✓"; display: grid; place-items: center; border-color: var(--lime); background: var(--lime); color: var(--ink); font: 700 .65rem/1 var(--font-mono); }
.choice input:checked + span::after { content: ""; position: absolute; top: 0; right: 0; width: .7rem; height: .7rem; background: linear-gradient(225deg,var(--lime) 0 49%,transparent 50%); }
.day { flex: 1; }
.day span { width: 100%; min-width: 3.25rem; min-height: 3.5rem; justify-content: center; padding: 0 .45rem; border-radius: 0; }
.day span::before { display: none; }
.field:has(.day) .choice-row { gap: 0; overflow: hidden; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); }
.field:has(.day) .day span { border: 0; border-right: 1px solid var(--hairline); background: transparent; color: var(--ink); }
.field:has(.day) .day:last-child span { border-right: 0; }
.field:has(.day) .day input:checked + span { background: var(--lime-wash); color: var(--ink); box-shadow: inset 0 -2px var(--lime-ink); }
.field:has(.day) .day input:checked + span::after { display: none; }
.error { color: var(--red-ink) !important; }
.server-error { margin: 1.6rem 0 0; padding: .75rem .9rem; border: 1px solid color-mix(in oklch,var(--red-ink) 34%,transparent); border-radius: 10px; background: var(--red-soft); color: var(--red-ink); font-size: .82rem; }
.form-actions { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 1rem; margin: 2.75rem -3.5rem 0; padding: 1rem 3.5rem; border-top: 1px solid var(--hairline); background: color-mix(in oklch,var(--bone) 90%,transparent); backdrop-filter: blur(10px); }
.form-actions::before { content: "18 项字段 · 仅存于本机"; margin-right: auto; color: var(--graphite); font: .66rem/1.7 var(--font-mono); }
.form-actions :deep(button) { min-width: 8rem; }
.preview-card { display: grid; gap: 1.4rem; }
.dialog-eyebrow { color: var(--graphite); font: .65rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.dialog-note { align-self: center; margin-right: auto; color: var(--graphite); font: .65rem/1.4 var(--font-mono); }
.estimate-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); overflow: hidden; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-2); }
.estimate-grid div { min-width: 0; padding: 1rem; border-left: 1px solid var(--hairline); text-align: left; }
.estimate-grid div:first-child { border-left: 0; }
.estimate-grid strong,.estimate-grid span { display: block; }
.estimate-grid strong { color: var(--ink); font: 500 1.85rem/1 var(--font-mono); letter-spacing: -.03em; }
.estimate-grid span { margin-top: .55rem; color: var(--graphite); font: .62rem/1.4 var(--font-mono); letter-spacing: .06em; }
.preview-card pre { margin: 0; padding: 1.1rem 1.25rem; white-space: pre-wrap; border: 1px solid var(--hairline); border-left: 3px solid var(--ink); border-radius: 10px; background: var(--surface); color: var(--ink); font: .84rem/1.9 var(--font-body); }
:global(.profile-dialog) { width: min(41.25rem,calc(100% - 2rem)); max-width: 41.25rem; max-height: 85vh; translate: none !important; transform: translate(-50%,-50%); gap: 1.35rem; overflow-y: auto; padding: 1.75rem; border-color: var(--hairline-2); border-radius: 20px; background: var(--surface); box-shadow: 0 30px 70px -28px color-mix(in oklch,var(--ink) 55%,transparent); }
:global(.profile-dialog [data-slot="dialog-title"]) { font-family: var(--font-editorial); font-size: 1.65rem; font-weight: 600; }
:global(.profile-dialog [data-slot="dialog-description"]) { color: var(--graphite); line-height: 1.7; }
:global([data-slot="dialog-overlay"]) { background: color-mix(in oklch,var(--ink) 48%,transparent); backdrop-filter: blur(3px); }
@media (max-width: 760px) {
    .form-section header { grid-template-columns: 3.4rem minmax(0,1fr); gap: .9rem; padding: 1.25rem 0 1.1rem; margin-top: 1.65rem; }
    .form-section header > span { font-size: 1.9rem; }
    .form-section h2 { font-size: 1.05rem; }
    .field-grid { grid-template-columns: 1fr; gap: 1.25rem; }
    .span-2 { grid-column: auto; }
    .day span { min-width: 0; font-size: .7rem; }
    .form-actions { margin: 2rem -1.15rem 0; padding: .8rem 1.15rem; flex-wrap: wrap; }
    .form-actions::before { flex-basis: 100%; }
    .form-actions :deep(button) { width: 100%; }
    .estimate-grid { grid-template-columns: repeat(2,1fr); }
    .estimate-grid div:nth-child(3) { border-left: 0; border-top: 1px solid var(--hairline); }
    .estimate-grid div:nth-child(4) { border-top: 1px solid var(--hairline); }
    :global(.profile-dialog) { top: auto !important; right: auto !important; bottom: 0; left: 50% !important; width: 100% !important; max-width: 100%; max-height: 88vh; transform: translate(-50%,0) !important; border-radius: 20px 20px 0 0; }
}
</style>
