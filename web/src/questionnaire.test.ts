import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { isLatestPendingQuestionnaire, parseQuestionnaireInput, questionnaireAnswerText } from "./questionnaire";

const input = { questions: [{ id: "meal", label: "餐次", prompt: "是哪一餐？", options: [{ value: "lunch", label: "午餐", description: "中午吃的" }], allowOther: true }] };

describe("结构化问卷", () => {
    it("解析问题并生成可读回答", () => {
        const questions = parseQuestionnaireInput(input);
        expect(questions).toHaveLength(1);
        expect(questionnaireAnswerText(questions, { meal: "lunch" })).toBe("问卷回答：\n- 是哪一餐？：午餐");
        expect(() => questionnaireAnswerText(questions, {})).toThrow("请回答全部问题");
    });

    it("只允许最新且后面没有用户回复的问卷提交", () => {
        const askPart = { type: "dynamic-tool", toolCallId: "ask-1", toolName: "ask_user", state: "output-available", input, output: {} } as const;
        const messages = [{ id: "a", role: "assistant", parts: [askPart] }] as UIMessage[];
        expect(isLatestPendingQuestionnaire(messages, 0, "ask-1")).toBe(true);
        messages.push({ id: "u", role: "user", parts: [{ type: "text", text: "回答" }] });
        expect(isLatestPendingQuestionnaire(messages, 0, "ask-1")).toBe(false);
    });
});
