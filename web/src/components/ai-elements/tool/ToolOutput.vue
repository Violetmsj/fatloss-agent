<script setup lang="ts">
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed, isVNode } from 'vue'
import { CodeBlock } from '../code-block'

export type ToolPart = ToolUIPart | DynamicToolUIPart

interface Props extends /* @vue-ignore */ HTMLAttributes {
  output: ToolPart['output']
  errorText: ToolPart['errorText']
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const showOutput = computed(() => props.output || props.errorText)

const isObjectOutput = computed(
  () => typeof props.output === 'object' && !isVNode(props.output),
)
const isStringOutput = computed(() => typeof props.output === 'string')
const reportOutput = computed(() => {
  if (!props.output || typeof props.output !== 'object') return null
  const value = props.output as { summary?: unknown; reportUrl?: unknown }
  return typeof value.summary === 'string' && typeof value.reportUrl === 'string'
    && /^\/reports\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.reportUrl)
    ? { summary: value.summary, reportUrl: value.reportUrl } : null
})

const formattedOutput = computed(() => {
  if (isObjectOutput.value) {
    return JSON.stringify(props.output, null, 2)
  }
  return props.output as string
})
</script>

<template>
  <div
    v-if="showOutput"
    :class="cn('space-y-2 p-4', props.class)"
    v-bind="$attrs"
  >
    <h4
      class="font-medium text-muted-foreground text-xs uppercase tracking-wide"
    >
      {{ props.errorText ? "错误原因" : "执行结果" }}
    </h4>
    <div
      :class="
        cn(
          'overflow-x-auto rounded-md text-xs [&_table]:w-full',
          props.errorText
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/50 text-foreground',
        )
      "
    >
      <!-- Error text -->
      <div v-if="errorText">
        {{ props.errorText }}
      </div>

      <!-- Output rendering based on type -->
      <CodeBlock
        v-if="isObjectOutput && !reportOutput"
        :code="formattedOutput"
        language="json"
      />
      <CodeBlock
        v-else-if="isStringOutput && !reportOutput"
        :code="formattedOutput"
        language="json"
      />
      <div v-else-if="reportOutput" class="p-3 space-y-2">
        <p>{{ reportOutput.summary }}</p>
        <RouterLink :to="reportOutput.reportUrl" class="underline">查看报告</RouterLink>
      </div>
      <div v-else>
        {{ props.output }}
      </div>
    </div>
  </div>
</template>
