<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api, type ProfileResponse } from "../api";
import ProfileForm from "../components/ProfileForm.vue";

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
    <main class="profile-page">
        <button class="back" type="button" @click="$router.back()"><ArrowLeftIcon />返回聊天</button>
        <div class="page-heading"><span>个人画像</span><h1>查看与更新建档</h1><p>覆盖保存前会再次展示估算结果，已有数据库记录不会被迁移或重置。</p></div>
        <ProfileForm v-if="data" :definition="data" :initial-profile="data.profile" submit-label="预览更新" @saved="saved" />
        <p v-else-if="error" class="load-error">{{ error }}</p>
        <p v-else>正在加载画像…</p>
    </main>
</template>

<style scoped>
.profile-page { width: min(900px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 5rem; }
.back { display: inline-flex; gap: .4rem; align-items: center; border: 0; background: none; color: var(--muted-foreground); cursor: pointer; }
.back svg { width: 1rem; }
.page-heading { margin: 2rem 0; }
.page-heading span { color: var(--primary); font-size: .78rem; font-weight: 750; letter-spacing: .08em; }
.page-heading h1 { margin: .45rem 0; font-size: clamp(1.7rem, 4vw, 2.6rem); }
.page-heading p { color: var(--muted-foreground); }
.load-error { color: var(--destructive); }
</style>
