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
.image-attachment-header { padding: .55rem .65rem .2rem; }
.image-attachment { position: relative; width: 5.25rem; display: grid; gap: .25rem; }
.image-attachment img { width: 5.25rem; height: 4rem; border-radius: .5rem; border: 1px solid var(--border); object-fit: cover; background: var(--muted); }
.image-attachment span { overflow: hidden; color: var(--muted-foreground); font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
.image-attachment button { position: absolute; top: .2rem; right: .2rem; width: 1.25rem; height: 1.25rem; display: grid; place-items: center; border: 0; border-radius: 999px; background: rgb(0 0 0 / 65%); color: white; cursor: pointer; }
.image-attachment button:hover { background: rgb(0 0 0 / 82%); }
.image-attachment button svg { width: .75rem; height: .75rem; }
</style>
