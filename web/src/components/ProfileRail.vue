<script setup lang="ts">
defineProps<{ existing?: boolean }>();
</script>

<template>
    <aside class="profile-rail" aria-hidden="true">
        <div class="rail-brand">
            <span class="rail-glyph">轻</span>
            <span>减脂陪伴</span>
        </div>
        <ol>
            <li :class="{ done: existing }"><b>01</b><span>基础身体信息</span></li>
            <li :class="{ done: existing }"><b>02</b><span>减脂目标</span></li>
            <li :class="{ done: existing }"><b>03</b><span>生活方式</span></li>
            <li :class="{ done: existing }"><b>04</b><span>训练偏好</span></li>
        </ol>
        <p v-if="existing">档案已存在<br>覆盖保存<br>不迁移原记录</p>
        <p v-else>18 项字段<br>仅存于本机<br>不上传云端</p>
    </aside>
</template>

<style scoped>
.profile-rail { position: sticky; top: 0; width: 14.75rem; height: 100dvh; flex: 0 0 14.75rem; padding: 2rem 1.65rem; border-right: 1px solid var(--hairline); background: color-mix(in oklch, var(--surface) 55%, var(--bone)); }
.rail-brand { display: flex; align-items: center; gap: .65rem; margin-bottom: 2.5rem; font: 600 .85rem/1 var(--font-display); }
.rail-glyph { display: grid; place-items: center; width: 2.15rem; height: 2.15rem; color: var(--lime); background: var(--ink); clip-path: polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%); font-family: var(--font-editorial); font-size: 1rem; }
ol { position: relative; display: grid; gap: 0; margin: 0; padding: 0 0 0 1.4rem; list-style: none; }
ol::before { content: ""; position: absolute; top: .4rem; bottom: .4rem; left: .3rem; width: 1px; background: var(--hairline-2); }
li { position: relative; display: grid; gap: .15rem; padding: .75rem 0; }
li::before { content: ""; position: absolute; top: 1.15rem; left: -1.28rem; width: .45rem; height: .45rem; border: 1px solid var(--hairline-2); border-radius: 2px; background: var(--surface); }
li.done::before { border-color: var(--mint-ink); background: var(--mint-ink); }
li b { color: var(--graphite); font: 400 .66rem/1 var(--font-mono); letter-spacing: .06em; }
li span { font-size: .8rem; }
p { margin: 1.75rem 0 0; color: var(--graphite); font: .66rem/1.9 var(--font-mono); }
@media (max-width: 760px) { .profile-rail { display: none; } }
</style>
