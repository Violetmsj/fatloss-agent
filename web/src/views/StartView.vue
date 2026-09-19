<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { api } from "../api";

const router = useRouter();
const error = ref("");

onMounted(async () => {
    try {
        // 画像与会话互不依赖，并行读取可缩短首次进入等待时间。
        const [profile, conversations] = await Promise.all([api.getProfile(), api.listConversations()]);
        if (!profile.profile) {
            await router.replace("/onboarding");
            return;
        }
        // 已建档时恢复最近会话；全新用户才创建第一个空白会话。
        const conversation = conversations[0] ?? await api.createConversation();
        await router.replace(`/chat/${conversation.id}`);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "Web 服务暂时不可用。";
    }
});
</script>

<template>
    <main class="start-page">
        <div class="start-grain" />
        <div class="start-content">
            <div class="signal-rings" aria-hidden="true">
                <i class="ring ring-one" /><i class="ring ring-two" /><i class="ring ring-three" />
            </div>
            <div class="brand-mark">轻</div>
            <h1>减脂陪伴 Agent</h1>
            <template v-if="!error">
                <p>正在恢复你的画像和会话…</p>
                <div class="scan-line" aria-hidden="true"><i /></div>
                <span class="privacy-line">本机私有 · 单用户 · 不上传云端</span>
            </template>
            <div v-else class="start-error" role="alert">
                <span>Web 服务错误</span>
                <p>{{ error }}</p>
                <button type="button" @click="$router.go(0)">重新连接</button>
            </div>
        </div>
        <p class="start-foot">数据只保存在这台设备上</p>
    </main>
</template>

<style scoped>
.start-page { position: relative; min-height: 100dvh; display: grid; place-items: center; overflow: hidden; background: var(--ink); color: var(--rail-fg); }
.start-grain { position: absolute; inset: 0; opacity: .08; pointer-events: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.28'/%3E%3C/svg%3E"); }
.start-content { position: relative; z-index: 1; width: min(29rem, calc(100% - 2rem)); display: flex; flex-direction: column; align-items: center; text-align: center; }
.signal-rings { position: absolute; top: -10.7rem; left: 50%; width: 27rem; height: 27rem; transform: translateX(-50%); pointer-events: none; }
.ring { position: absolute; inset: 0; border: 1px solid var(--rail-line); border-radius: 50%; }
.ring-one { inset: 2rem; border-style: dashed; animation: field-spin 90s linear infinite; }
.ring-two { inset: 5.1rem; border-color: color-mix(in oklch, var(--lime) 35%, transparent); border-top-color: transparent; animation: field-spin 35s linear infinite reverse; }
.ring-three { inset: 7.7rem; animation: field-breathe 7.5s ease-in-out infinite; }
.brand-mark { position: relative; display: grid; place-items: center; width: 5.5rem; height: 5.5rem; color: var(--lime); border: 1px solid color-mix(in oklch, var(--lime) 45%, transparent); background: color-mix(in oklch, var(--lime) 8%, var(--ink)); clip-path: polygon(0 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%); font: 600 2.5rem/1 var(--font-editorial); }
h1 { margin: 2rem 0 0; font: 600 1.9rem/1.2 var(--font-editorial); letter-spacing: -.02em; }
.start-content > p { margin: .75rem 0 0; color: var(--rail-muted); font-size: .84rem; }
.scan-line { position: relative; width: 13.75rem; height: 1px; margin-top: 1.4rem; overflow: hidden; background: var(--rail-line); }
.scan-line i { position: absolute; inset: 0 auto 0 0; width: 42%; background: var(--lime); animation: field-scan 2.4s ease-in-out infinite; }
.privacy-line { margin-top: 1.5rem; color: var(--rail-muted); font: .66rem/1.5 var(--font-mono); letter-spacing: .08em; }
.start-error { width: 100%; margin-top: 1.7rem; padding: 1rem 1.1rem; text-align: left; color: var(--rail-fg); border: 1px solid color-mix(in oklch, var(--red) 42%, transparent); border-radius: 10px; background: color-mix(in oklch, var(--red) 12%, var(--ink)); }
.start-error > span { color: var(--red); font: .67rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.start-error p { margin: .6rem 0 0; font-size: .84rem; line-height: 1.7; }
.start-error button { min-height: 2.75rem; margin-top: 1rem; padding: 0 1.25rem; color: var(--ink); border: 0; border-radius: 10px; background: var(--lime); clip-path: polygon(0 0,100% 0,100% calc(100% - 11px),calc(100% - 11px) 100%,0 100%); font-weight: 600; }
.start-foot { position: absolute; bottom: 1.35rem; margin: 0; color: var(--rail-muted); font: .66rem/1 var(--font-mono); letter-spacing: .08em; }
</style>
