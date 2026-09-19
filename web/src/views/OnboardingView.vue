<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api, type ProfileResponse } from "../api";
import ProfileForm from "../components/ProfileForm.vue";
import ProfileRail from "../components/ProfileRail.vue";

const router = useRouter();
const data = ref<ProfileResponse | null>(null);
const error = ref("");

onMounted(async () => {
    try {
        data.value = await api.getProfile();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "加载建档信息失败。";
    }
});

async function finish(): Promise<void> {
    const conversations = await api.listConversations();
    const conversation = conversations[0] ?? await api.createConversation();
    await router.replace(`/chat/${conversation.id}`);
}
</script>

<template>
    <main class="profile-shell">
        <ProfileRail :existing="!!data?.profile" />
        <div class="profile-scroll">
            <div class="profile-page">
                <div class="page-heading"><span><i />减脂陪伴 Agent</span><h1>{{ data?.profile ? "更新你的减脂画像" : "先认识一下你" }}</h1><p>这些信息只保存在你的本机，用来生成更贴合实际的饮食与训练建议。</p></div>
                <ProfileForm v-if="data" :definition="data" :initial-profile="data.profile" @saved="finish" />
                <p v-else-if="error" class="load-error">{{ error }}</p>
                <p v-else class="loading">正在加载表单…</p>
            </div>
        </div>
    </main>
</template>

<style scoped>
.profile-shell { min-height: 100dvh; display: flex; background: var(--bone); }
.profile-scroll { min-width: 0; flex: 1; }
.profile-page { width: min(56.25rem, calc(100% - 4rem)); margin: 0 auto; padding: 3.25rem 0 3rem; }
.page-heading { margin-bottom: 1.6rem; }
.page-heading span { display: inline-flex; align-items: center; gap: .5rem; color: var(--graphite); font: .67rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.page-heading span i { width: .4rem; height: .4rem; border-radius: 2px; background: var(--lime-ink); }
.page-heading h1 { margin: 1rem 0 0; font: 600 clamp(2rem, 4vw, 2.5rem)/1.2 var(--font-editorial); letter-spacing: -.02em; }
.page-heading p,.loading { max-width: 46ch; margin: .85rem 0 0; color: var(--graphite); font-size: .9rem; line-height: 1.85; }
.load-error { color: var(--red-ink); }
@media (max-width: 760px) { .profile-page { width: auto; padding: 1.4rem 1.15rem 1.5rem; } .page-heading h1 { font-size: 1.8rem; } }
</style>
