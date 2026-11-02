import assert from "node:assert/strict";
import test from "node:test";

import { createAskUserTool } from "../../src/core/tools/ask-user.ts";

const params = { questions: [{ id: "meal", prompt: "是哪一餐？", options: [{ value: "lunch", label: "午餐" }], allowOther: true }] };

test("问卷把规范化问题交给宿主并返回选项或自由输入", async () => {
    const tool = createAskUserTool();
    const signal = new AbortController().signal;
    for (const answer of [
        { id: "meal", value: "lunch", label: "午餐", wasCustom: false },
        { id: "meal", value: "加餐", label: "加餐", wasCustom: true },
    ]) {
        const output = await tool.execute("call", params, signal, undefined, {
            ask: async (questions, receivedSignal) => {
                assert.equal(receivedSignal, signal);
                assert.equal(questions[0].label, "问题 1");
                assert.equal(questions[0].allowOther, true);
                return { answers: [answer], cancelled: false };
            },
        });
        assert.equal(output.terminate, false);
        assert.deepEqual(output.details.answers, [answer]);
    }
});

test("问卷取消后结束当前回合，缺少宿主能力时明确报错", async () => {
    const tool = createAskUserTool();
    const cancelled = await tool.execute("call", params, undefined, undefined, {
        ask: async () => ({ answers: [], cancelled: true }),
    });
    assert.equal(cancelled.terminate, true);
    assert.equal(cancelled.details.cancelled, true);
    await assert.rejects(tool.execute("call", params, undefined, undefined, {}), /未配置 DSH 问卷/);
});
