import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { MemoryCoordinator } from "./core/memory-coordinator.ts";
import { MEMORY_EXTRACTION_PROMPT, formatMemory } from "./core/memory.ts";
import { toolContext, generateText } from "./host/runtime.ts";
import { dshTool } from "./host/tools.ts";
import systemPrompt from "./prompts/system.md";
import { registerFatlossToolPolicy } from "./host/context-tools.ts";
import type {} from "@deepseek-ai/dsh-commands";

export const name = "fatloss-agent";
export const inject = ["fatloss", "tools", "systemPrompt", "agents", "llm", "sessionProjections", "userQuestions", "commands"];

/** 此入口仅由减脂 preset 挂载；不修改其他 Agent 的能力。 */
export function apply(ctx: Context): void {
    const service = ctx.fatloss;
    const lifecycle = new AbortController();
    ctx.effect(() => () => lifecycle.abort());
    const lifetime = AbortSignal.any([lifecycle.signal, service.cancellation.signal]);
    const cancelled = new WeakSet<Agent>();
    const readMessages = (agent: Agent) => ctx.sessionProjections.stateOf(agent.session, "fatloss:messages")?.messages ?? [];
    for (const tool of service.tools) {
        const ownedTool = { ...tool, execute: (...args: Parameters<typeof tool.execute>) => service.run(() => tool.execute(...args)) };
        ctx.tools.register(dshTool(ownedTool, exec => toolContext(ctx, exec.agent!, () => readMessages(exec.agent!), exec.callId), () => service.changed(), (result, exec) => {
            if (tool.name === "ask_user" && (result.details as { cancelled?: boolean })?.cancelled) cancelled.add(exec.agent!);
        }, lifetime));
    }
    ctx.systemPrompt.section({ name: "fatloss:rules", order: 500, interpolate: false, text: systemPrompt });
    ctx.on("agent/created", ({ agent }) => {
        const local = agent.ctx;
        local.tools.presentAs("native");
        registerFatlossToolPolicy(local, service.host, service.tools.map(tool => tool.name));
        local.tools.guard(exec => cancelled.has(agent) && /^(add_|update_|delete_|create_|invalidate_|generate_)/.test(exec.name) ? "用户已取消本次操作，请等待新的用户输入。" : undefined);
        let claimedUserId: string | undefined;
        const coordinator = new MemoryCoordinator({
            store: service.memories, readMessages: () => readMessages(agent), getProfile: () => service.repository.get(),
            isIdle: () => agent.status === "idle" && agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0,
            extract: (input, signal) => generateText(local, agent, MEMORY_EXTRACTION_PROMPT, input, signal),
            notify: message => ctx.logger.info(message),
        });
        local.systemPrompt.context({ name: "fatloss:memory", order: 900, interpolate: false, required: true, text: () => {
            const latest = readMessages(agent).filter(message => message.role === "user").at(-1);
            return `${service.memories.context()}\n以上是当前唯一有效的长期记忆快照。旧快照仅为历史，不可将删除或失效内容当作当前了解。\n当前用户消息标识：${claimedUserId ?? latest?.id ?? "无"}`;
        } });
        local.on("agent/inbox/inserted", ({ message }) => { coordinator.input(); if (message.source.kind === "user") cancelled.delete(agent); });
        local.on("agent/inbox/claimed", ({ message }) => { if (["user", "user-question-reply"].includes(message.source.kind)) claimedUserId = `dsh:${message.id}`; });
        local.on("agent/status", ({ status }) => { if (status === "idle") coordinator.settled(); else coordinator.input(); });
        local.effect(() => () => coordinator.stop());
        coordinator.resume();
        return undefined;
    });
    ctx.commands.register({ name: "profile", description: "查看当前减脂画像", handler: () => ({ kind: "success", text: service.profile().profile ? JSON.stringify(service.profile().profile, null, 2) : "请打开减脂陪伴页面完成建档。" }) });
    ctx.commands.register({ name: "memories", description: "查看有效长期记忆", handler: () => ({ kind: "success", text: service.memories.list().items.map(formatMemory).join("\n") || "暂无长期记忆。" }) });
}
