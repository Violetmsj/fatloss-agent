import type { UIMessage } from "ai";

export interface QuestionnaireOption {
    value: string;
    label: string;
    description?: string;
}

export interface QuestionnaireQuestion {
    id: string;
    label?: string;
    prompt: string;
    options: QuestionnaireOption[];
    allowOther: boolean;
}

export function parseQuestionnaireInput(input: unknown): QuestionnaireQuestion[] {
    if (!input || typeof input !== "object" || !Array.isArray((input as { questions?: unknown }).questions)) return [];
    return (input as { questions: unknown[] }).questions.slice(0, 3).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const question = value as Record<string, unknown>;
        if (typeof question.id !== "string" || typeof question.prompt !== "string" || !Array.isArray(question.options)) return [];
        const options = question.options.flatMap((option) => {
            if (!option || typeof option !== "object") return [];
            const item = option as Record<string, unknown>;
            if (typeof item.value !== "string" || typeof item.label !== "string") return [];
            return [{ value: item.value, label: item.label, description: typeof item.description === "string" ? item.description : undefined }];
        });
        return [{ id: question.id, label: typeof question.label === "string" ? question.label : undefined, prompt: question.prompt, options, allowOther: question.allowOther !== false }];
    });
}

export function questionnaireAnswerText(questions: QuestionnaireQuestion[], answers: Record<string, string>): string {
    const lines = questions.map((question) => {
        const value = answers[question.id]?.trim();
        if (!value) throw new Error("请回答全部问题");
        const label = question.options.find((option) => option.value === value)?.label ?? value;
        return `- ${question.prompt}：${label}`;
    });
    // 仍通过现有聊天接口发送普通文本，让 pi 会话历史自然保存答案，无需额外挂起请求 API。
    return `问卷回答：\n${lines.join("\n")}`;
}

export function isLatestPendingQuestionnaire(messages: UIMessage[], messageIndex: number, toolCallId: string): boolean {
    // 只允许最后一条、且其后尚无用户消息的最后一个问卷可提交；历史问卷自动变为只读。
    const lastUserIndex = messages.reduce((latest, message, index) => message.role === "user" ? index : latest, -1);
    if (messageIndex <= lastUserIndex || messageIndex !== messages.length - 1) return false;
    const pendingIds = messages[messageIndex]?.parts.flatMap((part) => part.type === "dynamic-tool" && part.toolName === "ask_user" ? [part.toolCallId] : []) ?? [];
    return pendingIds.at(-1) === toolCallId;
}
