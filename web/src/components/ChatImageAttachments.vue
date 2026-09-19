<script setup lang="ts">
import { XIcon } from "@lucide/vue";

import { PromptInputHeader, usePromptInput } from "./ai-elements/prompt-input";

const { files, removeFile } = usePromptInput();
</script>

<template>
    <PromptInputHeader v-if="files.length" class="image-attachment-header">
        <div v-for="file in files" :key="file.id" class="image-attachment">
            <img :src="file.url" :alt="file.filename || '待发送图片'">
            <span :title="file.filename">{{ file.filename || "图片" }}</span>
            <button type="button" :aria-label="`移除 ${file.filename || '图片'}`" @click="removeFile(file.id)">
                <XIcon />
            </button>
        </div>
    </PromptInputHeader>
</template>

<style scoped>
.image-attachment-header { display: flex; flex-wrap: wrap; gap: .5rem; padding: .15rem .15rem .65rem; }
.image-attachment { position: relative; max-width: 13.75rem; display: inline-flex; align-items: center; gap: .5rem; padding: .3rem .35rem; border: 1px solid var(--hairline); border-radius: 8px; background: var(--surface-2); }
.image-attachment img { width: 2.4rem; height: 2.4rem; flex: none; border: 1px solid var(--hairline); border-radius: 5px; object-fit: cover; background: var(--surface-2); }
.image-attachment span { max-width: 7.5rem; overflow: hidden; color: var(--ink); font: .68rem/1.4 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.image-attachment button { position: relative; width: 1.75rem; height: 1.75rem; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--graphite); }
.image-attachment button:hover { color: var(--red-ink); background: var(--red-soft); }
.image-attachment button svg { width: .8rem; height: .8rem; }
</style>
