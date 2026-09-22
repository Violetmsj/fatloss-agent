<script setup lang="ts">
import { useChat } from "@ai-sdk/vue";
import { CheckIcon, CopyIcon, MenuIcon, PencilIcon, PlusIcon, Settings2Icon, Trash2Icon, XIcon } from "@lucide/vue";
import { DefaultChatTransport, type DynamicToolUIPart, type FileUIPart, type UIMessage } from "ai";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { api, type Conversation } from "../api";
import ChatImageAttachments from "../components/ChatImageAttachments.vue";
import ChatImageUploadButton from "../components/ChatImageUploadButton.vue";
import QuestionnaireCard from "../components/QuestionnaireCard.vue";
import { Conversation as ConversationBox, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "../components/ai-elements/conversation";
import { Loader } from "../components/ai-elements/loader";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "../components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools, type PromptInputMessage } from "../components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../components/ai-elements/tool";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { isLatestPendingQuestionnaire } from "../questionnaire";

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
const attachmentError = ref("");
const deleteTarget = ref<Conversation | null>(null);
const deleting = ref(false);
const deleteError = ref("");

const allowedImageTypes = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

// useChat 负责把消息增量和工具事件合并进当前 UIMessage 列表，并提供停止生成能力。
const { messages, status, error, sendMessage, stop } = useChat({
    id: conversationId,
    messages: [],
    transport: new DefaultChatTransport({
        api: `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        // pi-agent 自己持有完整会话；请求只上传最新消息，避免历史图片被反复编码传输。
        prepareSendMessagesRequest: ({ messages: currentMessages }) => ({ body: { messages: currentMessages.slice(-1) } }),
    }),
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

function askDelete(conversation: Conversation): void {
    deleteTarget.value = conversation;
    deleteError.value = "";
}

async function confirmDelete(): Promise<void> {
    const target = deleteTarget.value;
    if (!target || deleting.value) return;
    deleting.value = true;
    try {
        await api.deleteConversation(target.id);
        // 后端列表按最近修改时间排序，过滤后首项即剩余最新会话。
        conversations.value = conversations.value.filter((item) => item.id !== target.id);
        deleteTarget.value = null;
        if (target.id === conversationId) {
            const next = conversations.value[0];
            await router.replace(next ? `/chat/${next.id}` : "/start");
        }
    } catch (cause) {
        deleteError.value = cause instanceof Error ? cause.message : "删除失败，请稍后重试。";
    } finally {
        deleting.value = false;
    }
}

async function handleSubmit(payload: PromptInputMessage): Promise<void> {
    // 同一个按钮在生成期间承担“停止”职责，避免重复向同一会话提交 prompt。
    if (busy.value) {
        await stop();
        return;
    }
    const text = payload.text.trim();
    if (!text && payload.files.length === 0) return;
    attachmentError.value = "";
    // 纯图片也必须携带文本提示；后端会执行同样的兜底，避免绕过 WebUI 时出现行为差异。
    const submittedText = text || "请分析这些图片。";
    // 只发送 AI SDK 认识的字段，避免把 File 对象和前端临时 id 一并序列化进请求。
    const files: FileUIPart[] = payload.files.map((file) => ({
        type: "file",
        mediaType: file.mediaType,
        filename: file.filename,
        url: file.url,
    }));
    await sendMessage(files.length ? { text: submittedText, files } : { text: submittedText });
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (conversation && !conversation.firstMessage) conversation.firstMessage = submittedText;
}

function handleAttachmentError(error: { code: string; message: string }): void {
    const messages: Record<string, string> = {
        accept: "仅支持 JPEG、PNG、WebP 和 GIF 图片。",
        max_file_size: "每张图片不能超过 5MB。",
        max_files: "单次最多上传 4 张图片。",
    };
    attachmentError.value = messages[error.code] ?? error.message;
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

function isImageFile(part: UIMessage["parts"][number]): part is FileUIPart {
    return part.type === "file" && part.mediaType.startsWith("image/");
}

function hasToolInput(input: unknown): boolean {
    // 无参数工具仍在协议中携带 {}，这里只隐藏没有阅读价值的参数区域。
    if (!input || typeof input !== "object") return input !== undefined && input !== null;
    return Object.keys(input).length > 0;
}

async function submitQuestionnaire(text: string): Promise<void> {
    if (busy.value) return;
    await sendMessage({ text });
}

async function cancelQuestionnaire(): Promise<void> {
    await submitQuestionnaire("取消本次记录");
}
</script>

<template>
    <main class="chat-shell">
        <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
        <aside class="sidebar" :class="{ open: sidebarOpen }">
            <div class="sidebar-brand">
                <div class="brand-mark">轻</div><div><strong>减脂陪伴</strong><span><i />本机私有模式</span></div>
                <button class="mobile-close" type="button" aria-label="关闭侧栏" @click="sidebarOpen = false"><XIcon /></button>
            </div>
            <Button class="new-chat" variant="outline" @click="createConversation"><PlusIcon />新建会话<span class="new-chat-hint">NEW</span></Button>
            <nav aria-label="会话列表">
                <div v-for="conversation in conversations" :key="conversation.id" class="conversation-link" :class="{ active: conversation.id === conversationId }" role="button" tabindex="0" @click="router.push(`/chat/${conversation.id}`); sidebarOpen = false" @keydown.enter="router.push(`/chat/${conversation.id}`)">
                    <template v-if="renamingId === conversation.id">
                        <input v-model="renameValue" maxlength="80" autofocus @click.stop @keydown.enter.stop.prevent="saveRename(conversation)" @keydown.esc.stop="renamingId = null">
                        <span class="rename-actions" @click.stop><button type="button" aria-label="保存名称" @click="saveRename(conversation)"><CheckIcon /></button><button type="button" aria-label="取消重命名" @click="renamingId = null"><XIcon /></button></span>
                    </template>
                    <template v-else>
                        <span class="conversation-title">{{ titleOf(conversation) }}</span><span class="conversation-meta">{{ conversation.messageCount }} 条消息</span>
                        <span v-if="conversation.id === conversationId" class="conversation-marker">▍</span>
                        <button class="rename" type="button" aria-label="重命名会话" @click.stop="startRename(conversation)"><PencilIcon /></button>
                        <button class="delete" type="button" aria-label="删除会话" @click.stop="askDelete(conversation)"><Trash2Icon /></button>
                    </template>
                </div>
            </nav>
            <RouterLink class="profile-link" to="/profile"><Settings2Icon />个人画像</RouterLink>
        </aside>

        <section class="chat-main">
            <header class="chat-header">
                <button class="menu-button" type="button" aria-label="打开侧栏" @click="sidebarOpen = true"><MenuIcon /></button>
                <span class="channel-index">CH</span>
                <div><h1>{{ currentConversation ? titleOf(currentConversation) : "减脂陪伴 Agent" }}</h1><p>结合画像、长期记忆与知识库回答</p></div>
                <span class="signal-ticks" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            </header>
            <div v-if="pageError" class="state-message error-state"><p>{{ pageError }}</p><Button variant="outline" @click="$router.go(0)">重新加载</Button></div>
            <div v-else-if="loading" class="state-message"><Loader :size="22" /><p>正在恢复会话…</p></div>
            <ConversationBox v-else class="conversation-box">
                <ConversationContent class="stream-content">
                    <ConversationEmptyState v-if="messages.length === 0" class="empty-state">
                        <div class="empty-rings" aria-hidden="true"><i /><i /><i /></div>
                        <span class="empty-eyebrow"><i />LOCAL SIGNAL READY</span>
                        <h2>从今天的状态开始</h2>
                        <p>可以告诉我体重变化、饮食计划、训练安排，或直接问一个减脂问题。</p>
                    </ConversationEmptyState>
                    <Message v-for="(message, messageIndex) in messages" :key="message.id" :from="message.role" class="message-row">
                        <div class="message-stack">
                            <div class="message-role"><span />{{ message.role === "user" ? "我 · YOU" : "减脂陪伴 · AGENT" }}</div>
                            <MessageContent>
                                <template v-for="(part, index) in message.parts" :key="`${message.id}-${index}`">
                                    <MessageResponse v-if="part.type === 'text'" class="message-response" :content="part.text" />
                                    <img v-else-if="isImageFile(part)" class="message-image" :src="part.url" :alt="part.filename || '用户上传图片'">
                                    <QuestionnaireCard v-else-if="isDynamicTool(part) && part.toolName === 'ask_user'" :input="part.input" :active="isLatestPendingQuestionnaire(messages, messageIndex, part.toolCallId)" :disabled="busy" @submit="submitQuestionnaire" @cancel="cancelQuestionnaire" />
                                    <Tool v-else-if="isDynamicTool(part)" class="tool-card" :data-tool-state="part.state">
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
                <PromptInput class="composer" :accept="allowedImageTypes" multiple :max-files="4" :max-file-size="5 * 1024 * 1024" @submit="handleSubmit" @error="handleAttachmentError">
                    <ChatImageAttachments />
                    <PromptInputBody><PromptInputTextarea placeholder="告诉我你今天的饮食、训练或困惑…" /></PromptInputBody>
                    <PromptInputFooter><PromptInputTools><ChatImageUploadButton /></PromptInputTools><span>Enter 发送 · Shift+Enter 换行</span><PromptInputSubmit :status="status" :aria-label="busy ? '停止生成' : '发送消息'" @click="busy && $event.preventDefault(); busy && stop()" /></PromptInputFooter>
                </PromptInput>
                <p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
                <p class="notice">建议仅供健康管理参考，如有疾病或明显不适请咨询专业医生。</p>
            </footer>
        </section>

        <Dialog :open="!!deleteTarget" @update:open="(value: boolean) => { if (!value && !deleting) deleteTarget = null; }">
            <DialogContent class="delete-dialog">
                <DialogHeader>
                    <DialogTitle>删除会话</DialogTitle>
                    <DialogDescription>将删除「{{ deleteTarget ? titleOf(deleteTarget) : "" }}」的全部聊天记录，删除后不可恢复。</DialogDescription>
                </DialogHeader>
                <p v-if="deleteError" class="delete-error" role="alert">{{ deleteError }}</p>
                <DialogFooter>
                    <Button variant="outline" :disabled="deleting" @click="deleteTarget = null">取消</Button>
                    <Button variant="destructive" :disabled="deleting" @click="confirmDelete">{{ deleting ? "正在删除…" : "确认删除" }}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </main>
</template>

<style scoped>
.chat-shell { position: relative; height: 100dvh; display: flex; overflow: hidden; background: var(--bone); }
.sidebar { position: relative; z-index: 30; width: 18rem; flex: 0 0 18rem; display: flex; flex-direction: column; color: var(--rail-fg); background: var(--ink); }
.sidebar-brand { display: flex; align-items: center; gap: .75rem; padding: 1.1rem 1.15rem 1rem; }
.brand-mark { width: 2.5rem; height: 2.5rem; flex: none; display: grid; place-items: center; color: var(--lime); border: 1px solid color-mix(in oklch,var(--lime) 55%,transparent); background: color-mix(in oklch,var(--lime) 10%,var(--ink)); clip-path: polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%); font: 600 1.18rem/1 var(--font-editorial); }
.sidebar-brand strong,.sidebar-brand span { display: block; }
.sidebar-brand strong { font: 600 .94rem/1.2 var(--font-display); }
.sidebar-brand span { display: flex; align-items: center; gap: .35rem; margin-top: .25rem; color: var(--rail-muted); font: .65rem/1 var(--font-mono); }
.sidebar-brand span i { width: .35rem; height: .35rem; border-radius: 1px; background: var(--lime); }
.new-chat { width: calc(100% - 2.25rem); min-height: 2.75rem; justify-content: flex-start; margin: 0 1.125rem .85rem; padding: 0 .85rem; color: var(--lime); border-color: color-mix(in oklch,var(--lime) 42%,transparent); background: color-mix(in oklch,var(--lime) 7%,var(--ink)); clip-path: polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%); }
.new-chat:hover { color: var(--lime); border-color: var(--lime); background: color-mix(in oklch,var(--lime) 15%,var(--ink)); }
.new-chat-hint { margin-left: auto; color: color-mix(in oklch,var(--lime) 62%,var(--rail-muted)); font: .62rem/1 var(--font-mono); letter-spacing: .08em; }
nav { position: relative; min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0,1fr); align-content: start; overflow-y: auto; border-top: 1px solid var(--rail-line); }
nav::before { content: ""; position: absolute; left: .55rem; top: .9rem; bottom: .9rem; width: .3rem; opacity: .7; pointer-events: none; background-image: repeating-linear-gradient(to bottom,color-mix(in oklch,var(--bone) 26%,transparent) 0 1px,transparent 1px 8px); }
.conversation-link { position: relative; min-height: 3.5rem; width: 100%; padding: .55rem 4.6rem .55rem 1.4rem; border: 0; border-bottom: 1px solid var(--rail-line); background: transparent; color: var(--rail-fg); text-align: left; cursor: pointer; transition: background .18s ease; }
.conversation-link::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: transparent; }
.conversation-link:hover { background: color-mix(in oklch,var(--bone) 7%,transparent); }
.conversation-link.active { background: color-mix(in oklch,var(--lime) 9%,transparent); }
.conversation-link.active::before { background: var(--lime); }
.conversation-title,.conversation-meta { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.conversation-title { font-size: .84rem; }
.conversation-link.active .conversation-title { font-weight: 600; }
.conversation-meta { margin-top: .15rem; color: var(--rail-muted); font: .65rem/1.3 var(--font-mono); }
.conversation-marker { position: absolute; top: 1.1rem; right: 1rem; color: var(--lime); font: .65rem/1 var(--font-mono); transition: opacity .18s ease; }
.rename,.delete { position: absolute; right: .55rem; top: .7rem; width: 2rem; height: 2rem; display: grid; place-items: center; opacity: 0; border: 0; border-radius: 7px; background: transparent; color: var(--rail-muted); transition: opacity .18s ease,background .18s ease,color .18s ease; }
.delete { right: 2.4rem; }
.conversation-link:hover .rename,.conversation-link:focus-within .rename,.conversation-link:hover .delete,.conversation-link:focus-within .delete { opacity: 1; }
.conversation-link:hover .conversation-marker,.conversation-link:focus-within .conversation-marker { opacity: 0; }
.rename:hover { color: var(--rail-fg); background: color-mix(in oklch,var(--bone) 10%,transparent); }
.delete:hover { color: var(--red-ink); background: color-mix(in oklch,var(--bone) 10%,transparent); }
.rename svg,.delete svg,.rename-actions svg { width: .85rem; }
.conversation-link input { width: 100%; height: 2.25rem; padding: 0 .6rem; border: 1px solid var(--lime); border-radius: 8px; outline: none; background: color-mix(in oklch,var(--bone) 6%,var(--ink)); color: var(--rail-fg); font-size: .8rem; }
.rename-actions { display: flex; justify-content: flex-end; gap: .2rem; margin-top: .4rem; }
.rename-actions button { width: 2rem; height: 2rem; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--rail-muted); }
.rename-actions button:hover { color: var(--rail-fg); background: color-mix(in oklch,var(--bone) 10%,transparent); }
.profile-link { min-height: 4rem; display: flex; align-items: center; gap: .65rem; padding: .75rem 1.5rem; color: var(--rail-fg); border-top: 1px solid var(--rail-line); text-decoration: none; font-size: .86rem; }
.profile-link:hover { background: color-mix(in oklch,var(--bone) 8%,transparent); }
.profile-link svg { width: 1.05rem; color: var(--rail-muted); }
.profile-link:hover svg { color: var(--lime); }
.mobile-close,.menu-button { display: none; }
.chat-main { position: relative; min-width: 0; flex: 1; display: flex; flex-direction: column; background: var(--bone); isolation: isolate; }
.chat-main::before { content: ""; position: absolute; inset: 0; z-index: -1; opacity: .35; pointer-events: none; background-image: linear-gradient(to right,var(--ink-soft) 1px,transparent 1px),linear-gradient(to bottom,var(--ink-soft) 1px,transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(110% 72% at 50% 0%,black 6%,transparent 78%); }
.chat-header { min-height: 4.25rem; flex: none; display: flex; align-items: center; gap: .9rem; padding: .6rem 1.75rem; border-bottom: 1px solid var(--hairline); background: color-mix(in oklch,var(--bone) 88%,transparent); backdrop-filter: blur(10px); }
.channel-index { color: var(--graphite); font: .68rem/1 var(--font-mono); letter-spacing: .08em; }
.chat-header > div { min-width: 0; }
.chat-header h1 { overflow: hidden; margin: 0; font: 600 .98rem/1.2 var(--font-display); text-overflow: ellipsis; white-space: nowrap; }
.chat-header p { overflow: hidden; margin: .2rem 0 0; color: var(--graphite); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.signal-ticks { height: .9rem; display: flex; align-items: flex-end; gap: 3px; margin-left: auto; opacity: .55; }
.signal-ticks i { width: 2px; background: var(--hairline-2); }
.signal-ticks i:nth-child(1),.signal-ticks i:nth-child(5) { height: .3rem; }.signal-ticks i:nth-child(2),.signal-ticks i:nth-child(4) { height: .6rem; }.signal-ticks i:nth-child(3) { height: .9rem; }
.conversation-box { min-height: 0; }
.conversation-box :deep(.stream-content) { width: 100%; max-width: 50.75rem; min-height: 100%; gap: 2.1rem; margin: 0 auto; padding: 2.1rem 1.75rem 2rem 3.75rem; }
.conversation-box :deep(.stream-content)::before { content: ""; position: absolute; top: 2.5rem; bottom: 2rem; left: calc(50% - 25.4rem + 1.8rem); width: 1px; pointer-events: none; background-image: repeating-linear-gradient(to bottom,var(--hairline) 0 1px,transparent 1px 15px); }
.message-row { position: relative; max-width: 100%; }
.message-stack { min-width: 0; width: min(100%,44rem); display: grid; gap: .35rem; }
.message-role { display: flex; align-items: center; gap: .5rem; margin-bottom: .3rem; color: var(--graphite); font: .65rem/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.message-role span { width: .45rem; height: .45rem; flex: none; border-radius: 2px; background: var(--ink); }
.message-row.is-user { justify-content: flex-end; }
.message-row.is-user .message-stack { width: min(74%,34rem); justify-items: end; }
.message-row.is-user .message-role { justify-content: flex-end; }
.message-row.is-user .message-role span { background: var(--graphite); }
.message-row :deep([data-slot="message-content"]),.message-row :deep(.is-user\:dark) { overflow: visible; }
.message-row.is-user :deep(.is-user\:dark) { position: relative; padding: .85rem 1.1rem; border-radius: 12px; background: var(--ink); color: var(--rail-fg); clip-path: polygon(0 0,100% 0,100% 100%,10px 100%,0 calc(100% - 10px)); font-size: .92rem; line-height: 1.7; }
.message-row.is-user :deep(.is-user\:dark)::before { content: ""; position: absolute; inset: 12px auto 10px 0; width: 3px; background: var(--lime); }
.message-response { max-width: 70ch; color: var(--ink); font-size: .92rem; line-height: 1.78; }
.message-row.is-user .message-response { color: var(--rail-fg); }
.message-response :deep(h1),.message-response :deep(h2),.message-response :deep(h3),.message-response :deep(h4) { margin: 1.2rem 0 .5rem; font-family: var(--font-display); font-weight: 600; letter-spacing: -.01em; }
.message-response :deep(p) { margin: 0 0 .75rem; }
.message-response :deep(ul),.message-response :deep(ol) { margin: 0 0 .75rem; padding-left: 1.25rem; }
.message-response :deep(li::marker) { color: var(--graphite); }
.message-response :deep(blockquote) { margin: 0 0 .85rem; padding: .15rem 0 .15rem 1rem; border-left: 2px solid var(--lime-ink); color: var(--graphite); }
.message-response :deep(code) { border-radius: 6px; background: var(--ink-soft); padding: .12rem .3rem; font-family: var(--font-mono); font-size: .8rem; }
.message-response :deep(pre) { overflow-x: auto; margin: .5rem 0 1rem; padding: 1rem 1.1rem; border-radius: 10px; background: var(--ink); color: var(--rail-fg); }
.message-response :deep(a) { text-decoration: underline; text-decoration-color: var(--lime-ink); text-underline-offset: 3px; }
.message-image { display: block; width: min(22rem,100%); max-height: 23.25rem; margin-top: .2rem; padding: .35rem; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface); object-fit: contain; clip-path: polygon(0 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%); }
.message-stack :deep([data-slot="button"]) { color: var(--graphite); }
.message-stack :deep([data-slot="button"]:hover) { color: var(--ink); background: var(--ink-soft); }
.tool-card { --tool-state: var(--graphite); position: relative; width: min(34rem,100%); margin: .55rem 0; overflow: hidden; border: 1px solid var(--hairline); border-left: 3px solid var(--tool-state); border-radius: 10px; background: var(--surface); }
.tool-card[data-tool-state="input-available"] { --tool-state: var(--lime-ink); }
.tool-card[data-tool-state="approval-requested"],.tool-card[data-tool-state="approval-responded"],.tool-card[data-tool-state="output-available"] { --tool-state: var(--mint-ink); }
.tool-card[data-tool-state="output-error"] { --tool-state: var(--red-ink); }
.tool-card[data-tool-state="output-denied"] { --tool-state: var(--graphite); }
.tool-card[data-tool-state="input-available"]::after { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg,transparent,var(--lime),transparent); animation: field-scan 2.2s linear infinite; }
.tool-card :deep(button) { min-height: 2.9rem; padding: .4rem .75rem; }
.tool-card :deep(button > div:first-child) { min-width: 0; }
.tool-card :deep(button > div:first-child > svg) { width: 1.7rem; height: 1.7rem; padding: .35rem; border: 1px solid var(--hairline); border-radius: 6px; }
.tool-card :deep([data-slot="badge"]) { border: 1px solid color-mix(in oklch,var(--tool-state) 45%,transparent); border-radius: 6px; background: transparent; color: var(--tool-state); font: .62rem/1 var(--font-mono); }
.tool-card :deep([data-slot="collapsible-content"]) { border-top: 1px solid var(--hairline); }
.tool-card :deep(h4) { color: var(--graphite); font-family: var(--font-mono); font-size: .62rem; font-weight: 400; letter-spacing: .12em; }
.tool-card :deep(pre) { border: 1px solid var(--hairline); border-radius: 8px; background: var(--surface-2); color: var(--ink); font-size: .72rem; }
.empty-state { position: relative; min-height: 30rem; overflow: hidden; }
.empty-state > * { position: relative; z-index: 1; }
.empty-state h2 { margin: 0; font: 600 2.25rem/1.25 var(--font-editorial); letter-spacing: -.015em; }
.empty-state p { max-width: 36ch; margin: 1rem auto 0; color: var(--graphite); font-size: .92rem; line-height: 1.8; }
.empty-eyebrow { display: inline-flex; align-items: center; gap: .5rem; margin-bottom: 1.1rem; color: var(--graphite); font: .65rem/1 var(--font-mono); letter-spacing: .1em; }
.empty-eyebrow i { width: .4rem; height: .4rem; border-radius: 2px; background: var(--lime-ink); }
.empty-rings { position: absolute; z-index: 0; top: 50%; left: 50%; width: 28rem; height: 28rem; transform: translate(-50%,-50%); }
.empty-rings i { position: absolute; inset: 0; border: 1px solid var(--hairline); border-radius: 50%; }
.empty-rings i:nth-child(1) { inset: 2rem; border-style: dashed; animation: field-spin 90s linear infinite; }
.empty-rings i:nth-child(2) { inset: 5rem; border-color: color-mix(in oklch,var(--lime-ink) 35%,transparent); border-top-color: transparent; animation: field-spin 80s linear infinite reverse; }
.empty-rings i:nth-child(3) { inset: 8rem; animation: field-breathe 7.5s ease-in-out infinite; }
.waiting { display: flex; align-items: center; gap: .55rem; color: var(--graphite); font: .72rem/1.4 var(--font-mono); }
.stream-error,.state-message.error-state { color: var(--red-ink); }
.stream-error { padding: .75rem .9rem; border: 1px solid color-mix(in oklch,var(--red-ink) 34%,transparent); border-radius: 10px; background: var(--red-soft); font-size: .8rem; }
.state-message { flex: 1; display: grid; place-content: center; justify-items: center; gap: .8rem; color: var(--graphite); }
.composer-wrap { position: relative; z-index: 3; flex: none; padding: 0 clamp(.75rem,4vw,1.75rem) .85rem; background: linear-gradient(transparent,var(--bone) 24%); }
.composer { max-width: 48rem; margin: 0 auto; }
.composer :deep([data-slot="input-group"]) { position: relative; overflow: hidden; border: 1px solid var(--hairline); border-radius: 14px 14px 14px 4px; background: var(--surface); box-shadow: 0 1px 0 var(--ink-soft); }
.composer :deep([data-slot="input-group"]::before) { content: ""; position: absolute; top: -1px; left: 1.1rem; right: 4rem; height: .45rem; pointer-events: none; background-image: repeating-linear-gradient(to right,var(--hairline-2) 0 1px,transparent 1px 9px); mask-image: linear-gradient(to right,transparent,black 10%,black 82%,transparent); }
.composer :deep([data-slot="input-group"]:focus-within) { border-color: var(--lime-ink); box-shadow: 0 0 0 3px var(--lime-soft); }
.composer-wrap :deep(textarea) { min-height: 3.4rem; max-height: 11rem; padding: .8rem 1rem .4rem; color: var(--ink); font-size: .93rem; line-height: 1.7; }
.composer-wrap :deep([data-slot="input-group-addon"]) { padding: .35rem .65rem .5rem; }
.composer-wrap :deep([data-slot="input-group-addon"] > span) { margin-left: auto; color: var(--graphite); font: .65rem/1 var(--font-mono); }
.composer-wrap :deep(button[type="submit"]) { width: 2.75rem; height: 2.75rem; border-radius: 10px 10px 10px 3px; background: var(--lime); color: var(--ink); clip-path: polygon(0 0,100% 0,100% calc(100% - 11px),calc(100% - 11px) 100%,0 100%); }
.composer-wrap :deep(button[type="submit"]:hover) { background: color-mix(in oklch,var(--lime) 86%,var(--ink)); }
.attachment-error { max-width: 48rem; margin: .45rem auto 0; color: var(--red-ink); font-size: .75rem; }
.notice { max-width: 48rem; margin: .55rem auto 0; text-align: center; color: var(--graphite); font-size: .72rem; }
.delete-error { color: var(--red-ink); font-size: .8rem; }
:global(.delete-dialog) { width: min(26rem,calc(100% - 2rem)); max-width: 26rem; translate: none !important; transform: translate(-50%,-50%); gap: 1.1rem; border-color: var(--hairline-2); border-radius: 16px; background: var(--surface); box-shadow: 0 30px 70px -28px color-mix(in oklch,var(--ink) 55%,transparent); }
:global(.delete-dialog [data-slot="dialog-title"]) { font-family: var(--font-editorial); font-size: 1.3rem; font-weight: 600; }
:global(.delete-dialog [data-slot="dialog-description"]) { color: var(--graphite); line-height: 1.7; }
.sidebar-backdrop { display: none; }
.conversation-box :deep(button[aria-label="Scroll to bottom"]) { bottom: 1rem; border-color: var(--ink); border-radius: 999px; background: var(--ink); color: var(--rail-fg); box-shadow: 0 12px 26px -14px color-mix(in oklch,var(--ink) 70%,transparent); }
@media (max-width: 760px) {
    .sidebar { position: fixed; inset: 0 auto 0 0; width: min(19.4rem,86%); flex-basis: auto; transform: translateX(-102%); transition: transform .24s ease; }
    .sidebar.open { transform: none; box-shadow: 24px 0 60px -30px color-mix(in oklch,var(--ink) 80%,transparent); }
    .sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 20; background: color-mix(in oklch,var(--ink) 50%,transparent); backdrop-filter: blur(2px); }
    .mobile-close { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; margin-left: auto; border: 0; border-radius: 8px; background: transparent; color: var(--rail-muted); }
    .mobile-close svg,.menu-button svg { width: 1.1rem; }
    .menu-button { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--graphite); }
    .chat-header { min-height: 3.65rem; gap: .65rem; padding: .45rem .85rem; }
    .channel-index,.signal-ticks { display: none; }
    .chat-header h1 { font-size: .9rem; }
    .chat-header p { font-size: .68rem; }
    .conversation-box :deep(.stream-content) { gap: 1.6rem; padding: 1.25rem 1rem 1rem; }
    .conversation-box :deep(.stream-content)::before { display: none; }
    .message-row.is-user .message-stack { width: min(88%,34rem); }
    .message-response { font-size: .89rem; line-height: 1.8; }
    .tool-card { width: 100%; }
    .tool-card :deep(button) { gap: .45rem; }
    .tool-card :deep([data-slot="badge"]) { margin-left: auto; }
    .empty-state { min-height: 24rem; padding-inline: 1rem; }
    .empty-state h2 { font-size: 1.8rem; }
    .empty-state p { font-size: .88rem; }
    .empty-rings { width: 22rem; height: 22rem; }
    .composer-wrap { padding: 0 .75rem .75rem; }
    .composer-wrap :deep([data-slot="input-group-addon"]) { flex-wrap: wrap; }
    .composer-wrap :deep([data-slot="input-group-addon"] > span) { order: 3; flex-basis: 100%; padding-top: .2rem; }
    .notice { display: none; }
}
</style>
