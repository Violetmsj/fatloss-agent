<script setup lang="ts">
import { useChat } from "@ai-sdk/vue";
import { CheckIcon, CopyIcon, MenuIcon, PencilIcon, PlusIcon, Settings2Icon, XIcon } from "@lucide/vue";
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api, type Conversation } from "../api";
import { Conversation as ConversationBox, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "../components/ai-elements/conversation";
import { Loader } from "../components/ai-elements/loader";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "../components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, type PromptInputMessage } from "../components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../components/ai-elements/tool";
import { Button } from "../components/ui/button";

const route = useRoute();
const router = useRouter();
const conversationId = String(route.params.conversationId);
const conversations = ref<Conversation[]>([]);
const loading = ref(true);
const pageError = ref("");
const sidebarOpen = ref(false);
const renamingId = ref<string | null>(null);
const renameValue = ref("");
const copiedId = ref<string | null>(null);

// useChat 负责把消息增量和工具事件合并进当前 UIMessage 列表，并提供停止生成能力。
const { messages, status, error, sendMessage, stop } = useChat({
    id: conversationId,
    messages: [],
    transport: new DefaultChatTransport({ api: `/api/conversations/${encodeURIComponent(conversationId)}/messages` }),
});
const busy = computed(() => status.value === "submitted" || status.value === "streaming");
const currentConversation = computed(() => conversations.value.find((item) => item.id === conversationId));

onMounted(async () => {
    try {
        // 聊天是建档后的能力；直接访问会话 URL 时也必须执行一次画像前置检查。
        const profile = await api.getProfile();
        if (!profile.profile) {
            await router.replace("/onboarding");
            return;
        }
        // 侧栏元数据和当前会话历史独立加载，历史会由后端过滤 thinking 并恢复工具卡片。
        const [list, history] = await Promise.all([api.listConversations(), api.getMessages(conversationId)]);
        conversations.value = list;
        messages.value = history;
    } catch (cause) {
        pageError.value = cause instanceof Error ? cause.message : "会话加载失败。";
    } finally {
        loading.value = false;
    }
});

function titleOf(conversation: Conversation): string {
    return conversation.name?.trim() || conversation.firstMessage?.trim() || "新会话";
}

async function createConversation(): Promise<void> {
    const conversation = await api.createConversation();
    await router.push(`/chat/${conversation.id}`);
}

function startRename(conversation: Conversation): void {
    renamingId.value = conversation.id;
    renameValue.value = titleOf(conversation) === "新会话" ? "" : titleOf(conversation);
}

async function saveRename(conversation: Conversation): Promise<void> {
    const name = renameValue.value.trim();
    if (!name) return;
    await api.renameConversation(conversation.id, name);
    conversation.name = name;
    renamingId.value = null;
}

async function handleSubmit(payload: PromptInputMessage): Promise<void> {
    // 同一个按钮在生成期间承担“停止”职责，避免重复向同一会话提交 prompt。
    if (busy.value) {
        await stop();
        return;
    }
    const text = payload.text.trim();
    if (!text) return;
    await sendMessage({ text });
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (conversation && !conversation.firstMessage) conversation.firstMessage = text;
}

async function copyMessage(message: UIMessage): Promise<void> {
    const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    await navigator.clipboard.writeText(text);
    copiedId.value = message.id;
    window.setTimeout(() => { copiedId.value = null; }, 1500);
}

function isDynamicTool(part: UIMessage["parts"][number]): part is DynamicToolUIPart {
    return part.type === "dynamic-tool";
}

function hasToolInput(input: unknown): boolean {
    // 无参数工具仍在协议中携带 {}，这里只隐藏没有阅读价值的参数区域。
    if (!input || typeof input !== "object") return input !== undefined && input !== null;
    return Object.keys(input).length > 0;
}
</script>

<template>
    <main class="chat-shell">
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
        <aside class="sidebar" :class="{ open: sidebarOpen }">
            <div class="sidebar-brand">
                <div class="brand-mark">轻</div><div><strong>减脂陪伴</strong><span>本机私有模式</span></div>
                <button class="mobile-close" type="button" aria-label="关闭侧栏" @click="sidebarOpen = false"><XIcon /></button>
            </div>
            <Button class="new-chat" variant="outline" @click="createConversation"><PlusIcon />新建会话</Button>
            <nav aria-label="会话列表">
                <div v-for="conversation in conversations" :key="conversation.id" class="conversation-link" :class="{ active: conversation.id === conversationId }" role="button" tabindex="0" @click="router.push(`/chat/${conversation.id}`); sidebarOpen = false" @keydown.enter="router.push(`/chat/${conversation.id}`)">
                    <template v-if="renamingId === conversation.id">
                        <input v-model="renameValue" maxlength="80" autofocus @click.stop @keydown.enter.stop.prevent="saveRename(conversation)" @keydown.esc.stop="renamingId = null">
                        <span class="rename-actions" @click.stop><button type="button" aria-label="保存名称" @click="saveRename(conversation)"><CheckIcon /></button><button type="button" aria-label="取消重命名" @click="renamingId = null"><XIcon /></button></span>
                    </template>
                    <template v-else>
                        <span class="conversation-title">{{ titleOf(conversation) }}</span><span class="conversation-meta">{{ conversation.messageCount }} 条消息</span>
                        <button class="rename" type="button" aria-label="重命名会话" @click.stop="startRename(conversation)"><PencilIcon /></button>
                    </template>
                </div>
            </nav>
            <RouterLink class="profile-link" to="/profile"><Settings2Icon />个人画像</RouterLink>
        </aside>

        <section class="chat-main">
            <header class="chat-header">
                <button class="menu-button" type="button" aria-label="打开侧栏" @click="sidebarOpen = true"><MenuIcon /></button>
                <div><h1>{{ currentConversation ? titleOf(currentConversation) : "减脂陪伴 Agent" }}</h1><p>结合画像、长期记忆与知识库回答</p></div>
            </header>
            <div v-if="pageError" class="state-message error-state"><p>{{ pageError }}</p><Button variant="outline" @click="$router.go(0)">重新加载</Button></div>
            <div v-else-if="loading" class="state-message"><Loader :size="22" /><p>正在恢复会话…</p></div>
            <ConversationBox v-else class="conversation-box">
                <ConversationContent class="mx-auto w-full max-w-3xl px-4 py-8">
                    <ConversationEmptyState v-if="messages.length === 0" title="从今天的状态开始" description="可以告诉我体重变化、饮食计划、训练安排，或直接问一个减脂问题。" />
                    <Message v-for="message in messages" :key="message.id" :from="message.role" class="message-row">
                        <div class="message-stack">
                            <MessageContent>
                                <template v-for="(part, index) in message.parts" :key="`${message.id}-${index}`">
                                    <MessageResponse v-if="part.type === 'text'" :content="part.text" />
                                    <Tool v-else-if="isDynamicTool(part)" class="tool-card">
                                        <ToolHeader :type="part.type" :state="part.state" :tool-name="part.toolName" :title="part.title" />
                                        <ToolContent><ToolInput v-if="hasToolInput(part.input)" :input="part.input" /><ToolOutput :output="part.output" :error-text="part.errorText" /></ToolContent>
                                    </Tool>
                                </template>
                            </MessageContent>
                            <MessageActions v-if="message.role === 'assistant'">
                                <MessageAction tooltip="复制回答" @click="copyMessage(message)"><CheckIcon v-if="copiedId === message.id" /><CopyIcon v-else /></MessageAction>
                            </MessageActions>
                        </div>
                    </Message>
                    <div v-if="status === 'submitted'" class="waiting"><Loader /><span>正在思考并调用需要的工具…</span></div>
                    <div v-if="error" class="stream-error" role="alert">生成失败：{{ error.message }}</div>
                </ConversationContent>
                <ConversationScrollButton />
            </ConversationBox>
            <footer v-if="!loading && !pageError" class="composer-wrap">
                <PromptInput class="composer" @submit="handleSubmit">
                    <PromptInputBody><PromptInputTextarea placeholder="告诉我你今天的饮食、训练或困惑…" /></PromptInputBody>
                    <PromptInputFooter><span>Enter 发送 · Shift+Enter 换行</span><PromptInputSubmit :status="status" :aria-label="busy ? '停止生成' : '发送消息'" @click="busy && $event.preventDefault(); busy && stop()" /></PromptInputFooter>
                </PromptInput>
                <p class="notice">建议仅供健康管理参考，如有疾病或明显不适请咨询专业医生。</p>
            </footer>
        </section>
    </main>
</template>

<style scoped>
.chat-shell { height: 100dvh; display: flex; overflow: hidden; background: var(--background); }
.sidebar { width: 17rem; flex: none; display: flex; flex-direction: column; padding: 1rem; border-right: 1px solid var(--border); background: color-mix(in srgb, var(--muted) 55%, var(--background)); }
.sidebar-brand { display: flex; align-items: center; gap: .7rem; padding: .4rem .35rem 1rem; }
.brand-mark { width: 2.25rem; height: 2.25rem; display: grid; place-items: center; border-radius: .7rem; background: var(--primary); color: var(--primary-foreground); font-weight: 800; }
.sidebar-brand strong,.sidebar-brand span { display: block; }.sidebar-brand strong { font-size: .9rem; }.sidebar-brand span { color: var(--muted-foreground); font-size: .67rem; margin-top: .12rem; }
.new-chat { width: 100%; justify-content: flex-start; margin-bottom: .9rem; }
nav { min-height: 0; flex: 1; display: grid; align-content: start; gap: .3rem; overflow-y: auto; }
.conversation-link { position: relative; width: 100%; border: 0; border-radius: .65rem; background: transparent; padding: .7rem 2rem .7rem .75rem; text-align: left; cursor: pointer; }
.conversation-link:hover,.conversation-link.active { background: var(--accent); }
.conversation-title,.conversation-meta { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }.conversation-title { font-size: .83rem; font-weight: 600; }.conversation-meta { color: var(--muted-foreground); font-size: .67rem; margin-top: .2rem; }
.rename { display: none; position: absolute; right: .4rem; top: .7rem; border: 0; background: transparent; padding: .25rem; cursor: pointer; }.conversation-link:hover .rename { display: block; }.rename svg,.rename-actions svg { width: .8rem; }
.conversation-link input { width: 100%; border: 1px solid var(--ring); border-radius: .3rem; padding: .25rem; }.rename-actions { display: flex; gap: .1rem; margin-top: .3rem; }.rename-actions button { border: 0; background: transparent; cursor: pointer; }
.profile-link { display: flex; align-items: center; gap: .5rem; color: var(--foreground); text-decoration: none; border-top: 1px solid var(--border); padding: 1rem .5rem .2rem; font-size: .82rem; }.profile-link svg { width: 1rem; }.mobile-close,.menu-button { display: none; }
.chat-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }.chat-header { height: 4.25rem; flex: none; display: flex; align-items: center; gap: .7rem; border-bottom: 1px solid var(--border); padding: 0 1.25rem; }.chat-header h1 { margin: 0; font-size: .95rem; }.chat-header p { margin: .2rem 0 0; color: var(--muted-foreground); font-size: .7rem; }
.conversation-box { min-height: 0; }.message-row { max-width: 88%; }.message-stack { min-width: 0; display: grid; gap: .25rem; }.tool-card { width: min(34rem, 100%); border: 1px solid var(--border); }
.waiting { display: flex; gap: .55rem; align-items: center; color: var(--muted-foreground); font-size: .78rem; }.stream-error { border-radius: .6rem; background: color-mix(in srgb, var(--destructive) 8%, transparent); color: var(--destructive); padding: .75rem; font-size: .8rem; }
.state-message { flex: 1; display: grid; place-content: center; justify-items: center; gap: .8rem; color: var(--muted-foreground); }.error-state { color: var(--destructive); }
.composer-wrap { flex: none; padding: .75rem clamp(.75rem, 4vw, 2rem) 1rem; background: linear-gradient(transparent, var(--background) 20%); }.composer { max-width: 48rem; margin: 0 auto; }.composer-wrap :deep(textarea) { min-height: 3.2rem; max-height: 10rem; }.composer-wrap footer > span { color: var(--muted-foreground); font-size: .68rem; }.notice { max-width: 48rem; margin: .45rem auto 0; text-align: center; color: var(--muted-foreground); font-size: .63rem; }.sidebar-backdrop { display: none; }
@media (max-width: 760px) { .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 30; transform: translateX(-101%); transition: transform .2s ease; box-shadow: 15px 0 40px rgb(0 0 0 / 18%); }.sidebar.open { transform: translateX(0); }.sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 20; background: rgb(0 0 0 / 28%); }.mobile-close { display: grid; place-items: center; margin-left: auto; border: 0; background: transparent; }.mobile-close svg,.menu-button svg { width: 1.1rem; }.menu-button { display: grid; place-items: center; border: 0; background: transparent; padding: .3rem; }.message-row { max-width: 95%; }.chat-header { padding: 0 .75rem; }.composer-wrap { padding-inline: .6rem; }.notice { display: none; } }
</style>
