<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../api";

const router = useRouter();
const error = ref("");

onMounted(async () => {
    try {
        const [profile, conversations] = await Promise.all([api.getProfile(), api.listConversations()]);
        if (!profile.profile) {
            await router.replace("/onboarding");
            return;
        }
        const conversation = conversations[0] ?? await api.createConversation();
        await router.replace(`/chat/${conversation.id}`);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "Web 服务暂时不可用。";
    }
});
</script>

<template>
    <main class="start-page">
        <div class="brand-mark">轻</div>
        <h1>减脂陪伴 Agent</h1>
        <p v-if="!error">正在恢复你的画像和会话…</p>
        <p v-else class="start-error">{{ error }}</p>
        <button v-if="error" type="button" @click="$router.go(0)">重新连接</button>
    </main>
</template>

<style scoped>
.start-page { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: .7rem; background: radial-gradient(circle at 50% 35%, #dbeee0, transparent 28rem), var(--background); }
.brand-mark { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 1rem; background: var(--primary); color: var(--primary-foreground); font-weight: 800; }
h1 { margin: .3rem 0 0; font-size: 1.2rem; }
p { margin: 0; color: var(--muted-foreground); font-size: .86rem; }
.start-error { color: var(--destructive); }
button { border: 1px solid var(--border); border-radius: .5rem; padding: .45rem .8rem; background: var(--card); cursor: pointer; }
</style>
