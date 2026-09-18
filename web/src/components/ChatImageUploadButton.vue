<script setup lang="ts">
import { ImagePlusIcon } from "@lucide/vue";

import { PromptInputButton, usePromptInput } from "./ai-elements/prompt-input";

const { openFileDialog } = usePromptInput();
</script>

<template>
    <PromptInputButton aria-label="添加图片" title="添加图片" @click="openFileDialog">
        <ImagePlusIcon class="size-4" />
    </PromptInputButton>
</template>
