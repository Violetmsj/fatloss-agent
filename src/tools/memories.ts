import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { readMemoryMessages } from "../memory-runtime.ts";
import { MemoryConflictError, MemoryStore } from "../memory-store.ts";
import { memoryCategorySchema, memoryEvidenceSchema, memoryFields, type MemoryCandidate } from "../memory.ts";

/** 工具只负责让主 Agent 能调用业务操作；真正的来源校验与 SQL 都收口到 MemoryStore。 */
export function createMemoryTools(store: MemoryStore) {
    // 主 Agent 只允许以本轮最新用户消息为依据立即写入；更早的明确事实交给批处理。
    const write = (candidate: MemoryCandidate, ctx: ExtensionContext, version?: number) => {
        const messages = readMemoryMessages(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
        const latest = messages.filter((message) => message.role === "user").at(-1);
        if (!latest) throw new Error("没有可引用的用户消息。");
        if (candidate.action !== "create") {
            const before = store.list({ id: candidate.id, status: "all" }).items[0];
            if (!before || before.version !== version) throw new MemoryConflictError();
        }
        // 即时操作不传 processed：本条消息可能还有其他事实，需要留给后续自动提取。
        const result = store.apply([candidate], [latest], store.revision);
        return { content: [{ type: "text" as const, text: `长期记忆操作完成：${JSON.stringify(result)}。可用 /memories 查看。` }], details: result };
    };
    // defineTool 的三个关键字段：description 告诉模型何时用；parameters 描述参数；execute 真正执行。
    // “是否为明确请求”等语义判断依赖模型遵守说明；工具本身不具有读懂用户意图的独立分类器。
    return [
        defineTool({
            name: "list_memories", label: "查询长期记忆",
            description: "读取 SQLite 长期记忆，支持 ID、类别、文本包含筛选与分页（不是语义搜索）。默认仅有效记录；修改或删除前先查询 ID 和 version。用户询问记住了什么时使用。",
            parameters: Type.Object({
                id: Type.Optional(Type.String()), category: Type.Optional(memoryCategorySchema), text: Type.Optional(Type.String()),
                status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("inactive"), Type.Literal("all")])),
                limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
            }, { additionalProperties: false }),
            async execute(_id, filter) {
                const result = store.list(filter);
                return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
            },
        }),
        defineTool({
            name: "create_memory", label: "记住用户信息",
            description: "仅在用户明确要求记住时立即保存一条明确事实。必须引用当前用户消息 ID 和逐字原话，不推断、不把助手建议当偏好，不写 profile 已建模字段；一般陈述由后台提取。不需要重复确认。",
            parameters: Type.Object(memoryFields, { additionalProperties: false }),
            async execute(_id, fields, _signal, _update, ctx) { return write({ action: "create", ...fields }, ctx); },
        }),
        defineTool({
            name: "update_memory", label: "纠正长期记忆",
            description: "用户明确纠正已有记忆时使用；先查询，传入 ID、version、完整新内容和当前用户原话证据。含糊时澄清，不重复确认。",
            parameters: Type.Object({ id: Type.String(), version: Type.Integer({ minimum: 1 }), ...memoryFields }, { additionalProperties: false }),
            async execute(_id, { version, ...fields }, _signal, _update, ctx) { return write({ action: "update", ...fields }, ctx, version); },
        }),
        defineTool({
            name: "invalidate_memory", label: "失效长期记忆",
            description: "用户明确说明某记忆不再成立时使用，先查询 ID、version，引用当前用户原话。保留记录但不再用于回复。",
            parameters: Type.Object({ id: Type.String(), version: Type.Integer({ minimum: 1 }), evidence: memoryEvidenceSchema }, { additionalProperties: false }),
            async execute(_id, { version, ...fields }, _signal, _update, ctx) { return write({ action: "invalidate", ...fields }, ctx, version); },
        }),
        defineTool({
            name: "delete_memory", label: "删除长期记忆",
            description: "仅在用户明确要求忘记或删除时使用。先查出匹配的 ID、version；目标含糊先澄清，不重复确认。删除记忆正文和原话副本，不清除 pi 聊天历史，也不禁止用户以后重新表达。",
            parameters: Type.Object({ id: Type.String(), version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
            async execute(_id, { id, version }) {
                store.delete(id, version);
                return { content: [{ type: "text" as const, text: "该长期记忆已删除，不再作为记忆提供给后续回复。原始聊天历史未删除。" }], details: { id } };
            },
        }),
    ];
}
