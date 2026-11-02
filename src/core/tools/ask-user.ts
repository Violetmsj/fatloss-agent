import { defineTool } from "./definition.ts";
import { Type } from "typebox";

// 业务问卷保留选项值，由宿主负责呈现和收集用户回答。
const optionSchema = Type.Object({
    value: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
}, { additionalProperties: false });

const questionSchema = Type.Object({
    id: Type.String(),
    label: Type.Optional(Type.String()),
    prompt: Type.String(),
    options: Type.Array(optionSchema, { maxItems: 8 }),
    allowOther: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export interface AskUserQuestion {
    id: string;
    label?: string;
    prompt: string;
    options: { value: string; label: string; description?: string }[];
    allowOther?: boolean;
}

export function createAskUserTool() {
    return defineTool({
        name: "ask_user",
        label: "向用户提问",
        description: "缺少完成当前饮食或运动记录所必需的信息时，以结构化问卷询问用户。每次最多三个问题；只问食物、分量、餐次、运动时长、设备活动热量或估算所需强度等必要信息，不问备注和非必要营养素。",
        parameters: Type.Object({ questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }) }, { additionalProperties: false }),
        async execute(_id, { questions }, signal, _update, ctx) {
            const normalized = questions.map((question, index) => ({
                ...question,
                label: question.label?.trim() || `问题 ${index + 1}`,
                allowOther: question.allowOther !== false,
            }));
            if (!ctx.ask) throw new Error("当前会话未配置 DSH 问卷能力。");
            const reply = await ctx.ask(normalized, signal);
            const details = { questions: normalized, ...reply };
            return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details, terminate: reply.cancelled };
        },
    });
}
