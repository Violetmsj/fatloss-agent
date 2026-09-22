import assert from "node:assert/strict";
import test from "node:test";

import { createAskUserTool } from "../src/tools/ask-user.ts";

const params = { questions: [{ id: "meal", prompt: "是哪一餐？", options: [{ value: "lunch", label: "午餐" }], allowOther: true }] };

test("Web 问卷返回结构化数据并终止当前回合", async () => {
    const tool = createAskUserTool();
    const output = await tool.execute("call", params, new AbortController().signal, () => {}, { mode: "print" } as never);
    assert.equal(output.terminate, true);
    assert.equal(output.details.pending, true);
    assert.equal(output.details.questions[0].prompt, "是哪一餐？");
});

test("TUI 问卷支持选择和取消", async () => {
    const tool = createAskUserTool();
    const selected = await tool.execute("call", params, new AbortController().signal, () => {}, {
        mode: "tui",
        ui: { select: async () => "午餐", input: async () => undefined },
    } as never);
    assert.equal(selected.details.answers[0].value, "lunch");

    const cancelled = await tool.execute("call", params, new AbortController().signal, () => {}, {
        mode: "tui",
        ui: { select: async () => undefined, input: async () => undefined },
    } as never);
    assert.equal(cancelled.details.cancelled, true);
});
