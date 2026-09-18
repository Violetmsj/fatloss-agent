<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api, type ProfileResponse } from "../api";
import ProfileForm from "../components/ProfileForm.vue";

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
    <main class="profile-page">
        <div class="page-heading"><span>减脂陪伴 Agent</span><h1>{{ data?.profile ? "更新你的减脂画像" : "先认识一下你" }}</h1><p>这些信息只保存在你的本机，用来生成更贴合实际的饮食与训练建议。</p></div>
        <ProfileForm v-if="data" :definition="data" :initial-profile="data.profile" @saved="finish" />
        <p v-else-if="error" class="load-error">{{ error }}</p>
        <p v-else class="loading">正在加载表单…</p>
    </main>
</template>

<style scoped>
.profile-page { width: min(900px, calc(100% - 2rem)); margin: 0 auto; padding: clamp(2rem, 7vw, 5rem) 0 5rem; }
.page-heading { margin-bottom: 2rem; }
.page-heading span { color: var(--primary); font-size: .78rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.page-heading h1 { margin: .45rem 0; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -.04em; }
.page-heading p,.loading { color: var(--muted-foreground); }
.load-error { color: var(--destructive); }
</style>
