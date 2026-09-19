<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api, type ProfileResponse } from "../api";
import ProfileForm from "../components/ProfileForm.vue";
import ProfileRail from "../components/ProfileRail.vue";

const router = useRouter();
const data = ref<ProfileResponse | null>(null);
const error = ref("");
onMounted(async () => {
    try { data.value = await api.getProfile(); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "加载画像失败。"; }
});
async function saved(): Promise<void> {
    const conversations = await api.listConversations();
    if (conversations[0]) await router.push(`/chat/${conversations[0].id}`);
    else await router.push("/");
}
</script>

<template>
    <main class="profile-shell">
        <ProfileRail existing />
        <div class="profile-scroll">
            <div class="profile-page">
                <div class="page-actions"><button class="back" type="button" @click="$router.back()"><ArrowLeftIcon />返回聊天</button><span>个人画像</span></div>
                <div class="page-heading"><span class="brandline"><i />减脂陪伴 Agent</span><h1>查看与更新建档</h1><p>覆盖保存前会再次展示估算结果，补充活动水平时会保留其他画像信息和长期记忆。</p></div>
                <ProfileForm v-if="data" :definition="data" :initial-profile="data.profile" submit-label="预览更新" @saved="saved" />
                <p v-else-if="error" class="load-error">{{ error }}</p>
                <p v-else class="loading">正在加载画像…</p>
            </div>
        </div>
    </main>
</template>

<style scoped>
.profile-shell { min-height: 100dvh; display: flex; background: var(--bone); }
.profile-scroll { min-width: 0; flex: 1; }
.profile-page { width: min(56.25rem, calc(100% - 4rem)); margin: 0 auto; padding: 2rem 0 3rem; }
.page-actions { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.6rem; }
.page-actions > span { color: var(--graphite); font: .67rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.back { min-height: 2.5rem; display: inline-flex; gap: .45rem; align-items: center; padding: 0 .7rem; border: 0; border-radius: 8px; background: none; color: var(--graphite); }
.back:hover { color: var(--ink); background: var(--ink-soft); }
.back svg { width: 1rem; }
.page-heading { margin-bottom: 1.6rem; }
.brandline { display: inline-flex; align-items: center; gap: .5rem; color: var(--graphite); font: .67rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.brandline i { width: .4rem; height: .4rem; border-radius: 2px; background: var(--mint-ink); }
.page-heading h1 { margin: 1rem 0 0; font: 600 clamp(2rem, 4vw, 2.5rem)/1.2 var(--font-editorial); letter-spacing: -.02em; }
.page-heading p,.loading { max-width: 50ch; margin: .85rem 0 0; color: var(--graphite); font-size: .9rem; line-height: 1.85; }
.load-error { color: var(--red-ink); }
@media (max-width: 760px) { .profile-page { width: auto; padding: 1.4rem 1.15rem 1.5rem; } .page-heading h1 { font-size: 1.8rem; } }
</style>
