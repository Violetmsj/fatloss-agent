import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { randomUUID } from "node:crypto";
import type { FatlossToolContext } from "../../../src/tools/definition.ts";
import type { MemoryMessage } from "../../../src/memory.ts";
import type { AskUserQuestion } from "../../../src/tools/ask-user.ts";
import { reportUrl } from "./report-link.ts";
import type {} from "@deepseek-ai/dsh-user-questions";

export function selectedModel(agent: Agent) {
    const config = agent.session.requestHeader()?.config;
    const provider = config?.provider ?? agent.options.provider;
    const model = config?.model ?? agent.options.model;
    return provider && model ? { provider, model, reasoningEffort: agent.options.reasoningEffort } : undefined;
}

export async function generateText(ctx: Context, agent: Agent, system: string, input: string, signal: AbortSignal): Promise<string> {
    const selected = selectedModel(agent);
    if (!selected) throw new Error("请先在 DSH 中选择可用模型。");
    let text = "";
    let complete = false;
    for await (const chunk of ctx.llm.stream({
        ...selected, system, messages: [{ role: "user", content: [{ type: "text", text: input }] }], signal,
        // 报告与记忆提取是独立请求，不能被压缩插件归入主聊天的历史链。
        sessionId: SessionId(`fatloss-aux-${randomUUID()}`),
    })) {
        if (chunk.type === "text-delta") text += chunk.text;
        if (chunk.type === "finish") complete = chunk.reason.kind === "stop";
    }
    signal.throwIfAborted();
    if (!complete) throw new Error("模型未完整返回结果。");
    return text;
}

export async function research(ctx: Context, parent: Agent, prompt: string, signal?: AbortSignal): Promise<string> {
    // 根服务提供干净的所有权作用域，不继承减脂 preset 的局部工具与上下文。
    const root = ctx.fatloss.host;
    const selected = selectedModel(parent);
    if (!selected) throw new Error("当前没有可用于联网估算的模型。");
    const search = root.tools.get("web_search");
    if (!search) throw new Error("请在 DSH 中启用并配置 web_search 检索工具。");
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(45_000)]);
    const handle = await root.agents.create({
        sessionId: SessionId(randomUUID()), parentAgent: parent, agentOptions: selected, signal: combined,
        meta: { origin: "subagent" },
        setup: (childCtx) => {
            childCtx.tools.presentAs("native");
            childCtx.tools.restrict({ allow: [] });
            childCtx.tools.register(search);
            childCtx.tools.guard(exec => exec.name === "web_search" ? undefined : "检索子 Agent 只允许使用 web_search。");
            childCtx.systemPrompt.suppressRuntimeContext();
            childCtx.systemPrompt.section({ name: "fatloss:research", order: 0, complete: true, interpolate: false,
                text: "你是热量资料检索器。仅检索公开资料，不访问用户画像、数据库或主聊天。食物返回营养估算，运动只返回 MET。最终只返回要求的 JSON，不要代码围栏。" });
        },
    });
    const cancel = () => handle.agent.cancel({ kind: "user" });
    combined.addEventListener("abort", cancel, { once: true });
    try {
        combined.throwIfAborted();
        handle.agent.followup(createUserMessage({ content: [{ type: "text", text: prompt }], source: { kind: "user" } }));
        await handle.agent.whenIdle();
        combined.throwIfAborted();
        const last = handle.agent.session.deriveMessages().filter(message => message.role === "assistant").at(-1);
        if (!last) throw new Error("联网检索没有返回结果。");
        return last.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    } finally {
        combined.removeEventListener("abort", cancel);
        await handle.dispose();
    }
}

export function toolContext(ctx: Context, agent: Agent, messages: () => MemoryMessage[], callId: string): FatlossToolContext {
    const selected = selectedModel(agent);
    return {
        mode: "dsh", modelName: selected ? `${selected.provider}/${selected.model}` : null,
        generateText: (system, input, signal) => generateText(ctx, agent, system, input, signal),
        research: (_kind, prompt, signal) => research(ctx, agent, prompt, signal),
        readMessages: messages,
        reportUrl,
        ask: async (questions: AskUserQuestion[], signal?: AbortSignal) => {
            const reply = await ctx.userQuestions.ask({ agent, signal, wait: { callId: callId as never },
                questions: questions.map(question => ({ id: question.id, header: question.label, question: question.prompt,
                    options: question.options.map(({ label, description }) => ({ label, ...(description ? { description } : {}) })) })),
            });
            const answers = questions.flatMap(question => {
                const answer = reply.answers.find(item => item.id === question.id);
                const custom = answer?.custom?.trim();
                const label = custom || answer?.selected[0];
                if (!label) return [];
                const option = custom ? undefined : question.options.find(item => item.label === label);
                if (!option && question.allowOther === false) return [];
                return [{ id: question.id, value: option?.value ?? label, label, wasCustom: !option }];
            });
            const cancelled = answers.length !== questions.length;
            if (!cancelled) {
                // 将确实由人回答的内容归入用户证据，而不是把工具结果视为用户原话。
                agent.inject(createUserMessage({ content: [{ type: "text", text: answers.map(answer => `${questions.find(q => q.id === answer.id)!.prompt} ${answer.label}`).join("\n") }],
                    source: { kind: "user-question-reply", callId: callId as never, outcome: "answered" } }));
            }
            return { answers, cancelled, pending: false };
        },
    };
}
