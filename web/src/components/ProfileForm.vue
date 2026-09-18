<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import { api, ApiError, type ProfileFormDefinition, type ProfileInput, type ProfilePreview } from "../api";
import { validateProfileForm, type ProfileErrors } from "../profile-validation";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

const props = defineProps<{
    definition: ProfileFormDefinition;
    initialProfile?: ProfileInput | null;
    submitLabel?: string;
}>();
const emit = defineEmits<{ saved: [profile: ProfileInput] }>();

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
    activityFrequency: "",
    jobType: "",
    favoriteExercises: [],
    equipment: [],
    stairResponse: "",
    focusArea: "全身",
    trainingDays: [],
});
function copyProfile(profile: ProfileInput): ProfileInput {
    return {
        ...profile,
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
    { key: "age", label: "年龄", unit: "岁", step: 1 },
    { key: "heightCm", label: "身高", unit: "cm", step: 0.1 },
    { key: "weightKg", label: "体重", unit: "kg", step: 0.1 },
    { key: "bodyFatPct", label: "体脂率", unit: "%", step: 0.1 },
    { key: "waistCm", label: "腰围", unit: "cm", step: 0.1 },
    { key: "hipCm", label: "臀围（选填）", unit: "cm", step: 0.1 },
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
                <label class="field"><span>运动频次</span><select v-model="form.activityFrequency" :aria-invalid="!!errors.activityFrequency"><option disabled value="">请选择</option><option v-for="option in definition.options.activityFrequencies" :key="option">{{ option }}</option></select><small v-if="errors.activityFrequency" class="error">{{ errors.activityFrequency }}</small></label>
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
        <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>确认你的减脂画像</DialogTitle><DialogDescription>以下是静态热量换算的粗略估计，仅供制定计划参考。</DialogDescription></DialogHeader>
            <div v-if="preview" class="preview-card">
                <div class="estimate-grid"><div><strong>{{ preview.estimate.targetWeightKg.toFixed(1) }}</strong><span>目标体重 kg</span></div><div><strong>{{ preview.estimate.fatLossKg.toFixed(1) }}</strong><span>预计减重 kg</span></div><div><strong>{{ preview.estimate.estimatedWeeks }}</strong><span>预计周数</span></div><div><strong>{{ preview.estimate.speed }}</strong><span>速度</span></div></div>
                <pre>{{ preview.summary }}</pre>
            </div>
            <DialogFooter><Button variant="outline" :disabled="loading" @click="preview = null">返回修改</Button><Button :disabled="loading" @click="confirmSave">{{ loading ? "正在保存…" : "确认并保存" }}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<style scoped>
.profile-form { display: grid; gap: 1rem; }
.form-section { border: 1px solid var(--border); border-radius: 1rem; background: color-mix(in srgb, var(--card) 92%, transparent); padding: clamp(1rem, 3vw, 1.75rem); box-shadow: 0 12px 32px rgb(28 48 36 / 5%); }
.form-section header { display: flex; align-items: flex-start; gap: .8rem; margin-bottom: 1.4rem; }
.form-section header > span { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .65rem; background: var(--primary); color: var(--primary-foreground); font: 700 .75rem/1 monospace; }
h2 { margin: 0; font-size: 1.05rem; } p { margin: .2rem 0 0; color: var(--muted-foreground); font-size: .86rem; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }.field-stack { display: grid; gap: 1.15rem; }.span-2 { grid-column: span 2; }
.field { display: grid; gap: .45rem; border: 0; padding: 0; min-width: 0; }.field > span,.field legend { font-size: .86rem; font-weight: 650; }.field small { color: var(--muted-foreground); font-size: .76rem; }
input[type="number"], select { width: 100%; height: 2.65rem; border: 1px solid var(--input); border-radius: .65rem; background: var(--background); padding: 0 .8rem; outline: none; }
input:focus,select:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent); } [aria-invalid="true"] input,[aria-invalid="true"] select,input[aria-invalid="true"],select[aria-invalid="true"] { border-color: var(--destructive); }
.input-with-unit { position: relative; }.input-with-unit input { padding-right: 3.5rem; }.input-with-unit b { position: absolute; right: .8rem; top: 50%; transform: translateY(-50%); color: var(--muted-foreground); font-size: .76rem; }
.choice-row { display: flex; gap: .55rem; }.wrap { flex-wrap: wrap; }.choice input { position: absolute; opacity: 0; pointer-events: none; }.choice span { display: inline-flex; min-height: 2.4rem; align-items: center; border: 1px solid var(--border); border-radius: .65rem; padding: .55rem .85rem; background: var(--background); cursor: pointer; font-size: .84rem; }.choice input:checked + span { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, var(--background)); color: var(--primary); font-weight: 650; }.day span { min-width: 3.3rem; justify-content: center; }
.error { color: var(--destructive) !important; }.server-error { border-radius: .7rem; background: color-mix(in srgb, var(--destructive) 9%, white); color: var(--destructive); padding: .8rem 1rem; }.form-actions { display: flex; justify-content: flex-end; position: sticky; bottom: 1rem; }
.preview-card { display: grid; gap: 1rem; }.estimate-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; }.estimate-grid div { border-radius: .7rem; background: var(--muted); padding: .8rem; text-align: center; }.estimate-grid strong,.estimate-grid span { display: block; }.estimate-grid strong { color: var(--primary); font-size: 1.15rem; }.estimate-grid span { margin-top: .2rem; color: var(--muted-foreground); font-size: .68rem; }.preview-card pre { white-space: pre-wrap; font: inherit; font-size: .82rem; line-height: 1.75; background: var(--muted); border-radius: .7rem; padding: 1rem; }
@media (max-width: 640px) { .field-grid { grid-template-columns: 1fr; }.span-2 { grid-column: auto; }.estimate-grid { grid-template-columns: repeat(2, 1fr); }.form-actions { bottom: .5rem; }.form-actions button { width: 100%; } }
</style>
