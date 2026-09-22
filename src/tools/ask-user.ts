import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// 参数与答案结构沿用 pi 官方 questionnaire.ts；这里收紧为最多三题，并用 pi 原生对话框顺序呈现，
// 以便同一工具在 Web 模式下返回完全相同的结构化问卷协议。
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
        async execute(_id, { questions }, _signal, _update, ctx) {
            const normalized = questions.map((question, index) => ({
                ...question,
                label: question.label?.trim() || `问题 ${index + 1}`,
                allowOther: question.allowOther !== false,
            }));
            if (ctx.mode !== "tui") {
                // Web 没有可阻塞的终端 UI：把问卷放进工具事件并结束当前回合，答案由下一条用户消息续接。
                const details = { questions: normalized, answers: [], cancelled: false, pending: true };
                return {
                    content: [{ type: "text" as const, text: "已向用户显示问卷。当前回合到此结束，请等待用户提交答案后再继续。" }],
                    details,
                    terminate: true,
                };
            }

            // TUI 可以在当前工具调用内等待，因此按问题顺序收集后把结构化答案直接交还模型。
            const answers: { id: string; value: string; label: string; wasCustom: boolean }[] = [];
            for (const question of normalized) {
                const choices = question.options.map((option) => option.description ? `${option.label} — ${option.description}` : option.label);
                if (question.allowOther) choices.push("自由输入…");
                const selected = await ctx.ui.select(question.prompt, choices);
                if (selected === undefined) return cancelledResult(normalized);
                if (selected === "自由输入…") {
                    const value = (await ctx.ui.input(question.prompt, "请输入答案"))?.trim();
                    if (!value) return cancelledResult(normalized);
                    answers.push({ id: question.id, value, label: value, wasCustom: true });
                    continue;
                }
                const option = question.options[choices.indexOf(selected)];
                if (!option) return cancelledResult(normalized);
                answers.push({ id: question.id, value: option.value, label: option.label, wasCustom: false });
            }
            const details = { questions: normalized, answers, cancelled: false, pending: false };
            return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
        },
    });
}

function cancelledResult(questions: AskUserQuestion[]) {
    const details = { questions, answers: [], cancelled: true, pending: false };
    return { content: [{ type: "text" as const, text: "用户取消了本次问卷。不要继续写入记录。" }], details };
}
