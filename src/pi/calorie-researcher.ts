import {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import webSearch from "@pi-plugins/websearch";

import type { ResearchKind } from "../calorie-researcher.ts";

const CHILD_SYSTEM_PROMPT = `你是热量资料检索器。只能使用 web_search 查找公开资料，不得请求或推断用户身份、体重、画像或数据库内容。
优先权威或原始来源，明确区分事实与假设。最终只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。`;
export const RESEARCH_TOOL_ALLOWLIST = ["web_search"] as const;

function textFromMessages(messages: unknown[]): string {
    const last = [...messages].reverse().find((message) => (message as { role?: unknown })?.role === "assistant") as { content?: unknown } | undefined;
    if (!last) throw new Error("估算子 Agent 没有返回结果");
    if (typeof last.content === "string") return last.content;
    if (!Array.isArray(last.content)) throw new Error("估算子 Agent 返回格式无效");
    return last.content.flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string"
        ? [(block as { text: string }).text]
        : []).join("\n");
}

export async function runRestrictedResearchTurn(kind: ResearchKind, prompt: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<string> {
    if (!ctx?.model) throw new Error("当前没有可用于联网估算的模型");
    const loader = await createResearchResourceLoader();
    // 每次估算使用不持久化的全新会话，不继承主 Agent 的消息历史和数据库上下文。
    const { session } = await createAgentSession({
        model: ctx.model,
        thinkingLevel: "low",
        tools: [...RESEARCH_TOOL_ALLOWLIST],
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(process.cwd()),
    });
    let timedOut = false;
    const abort = () => void session.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        abort();
    }, 45_000);
    timeout.unref();
    try {
        await session.prompt(prompt);
        if (signal?.aborted) throw new Error("估算已取消");
        if (timedOut) throw new Error("联网估算超时");
        return textFromMessages(session.messages as unknown[]);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        session.dispose();
    }
}

export async function createResearchResourceLoader(): Promise<DefaultResourceLoader> {
    // 禁用项目扩展、Skill、提示模板和 AGENTS/SYSTEM 上下文，只注入固定版本的 web_search。
    // 配合 createAgentSession 的 tools 白名单形成双重限制，避免子 Agent 获得写库能力。
    const loader = new DefaultResourceLoader({
        cwd: process.cwd(), agentDir: getAgentDir(), noExtensions: true, noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true,
        systemPrompt: CHILD_SYSTEM_PROMPT,
        extensionFactories: [{ name: "websearch", factory: webSearch }],
    });
    await loader.reload();
    return loader;
}
