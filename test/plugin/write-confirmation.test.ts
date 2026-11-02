import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { createScope, scopeTarget } from "@deepseek-ai/dsh-scope";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { registerFatlossWriteConfirmation } from "../../src/host/write-confirmation.ts";

test("减脂写入只有单次审批通过才执行，拒绝和取消均阻止执行", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    const key = {};
    const scope = createScope(root, key);
    let outcome = "rejected";
    let asked = 0;
    root.provide("approval", { request: async (request: any) => {
        asked++;
        assert.equal(request.toolName, "update_current_profile");
        assert.equal(request.callId, "call-1");
        assert.equal(request.displayReason.zh, "确认更新减脂画像");
        return outcome;
    } } as any);
    registerFatlossWriteConfirmation(scope.ctx);
    const agent = {} as Agent;
    const exec = { name: "update_current_profile", arguments: { weightKg: 75 }, agent, callId: "call-1", signal: new AbortController().signal } as ToolExecution;
    let delegated = 0;
    const decide = () => root.waterfall(scopeTarget({} as ToolRuntime, key), "tools/pre-execute", exec, async () => { delegated++; return { kind: "allow" as const }; });
    assert.equal((await decide()).kind, "deny");
    assert.equal(delegated, 0);
    outcome = "cancelled";
    assert.equal((await decide()).kind, "cancel");
    outcome = "allowed-once";
    assert.equal((await decide()).kind, "allow");
    assert.equal(delegated, 1);
    assert.equal(asked, 3);
});

test("减脂确认只覆盖写入工具和当前预设，审批不可用时拒绝写入", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    const key = {};
    const scope = createScope(root, key);
    root.provide("approval", { request: async () => { throw new Error("没有审批提供方"); } } as any);
    registerFatlossWriteConfirmation(scope.ctx);
    const agent = {} as Agent;
    const signal = new AbortController().signal;
    const decide = (name: string, target: object) => root.waterfall(scopeTarget({} as ToolRuntime, target), "tools/pre-execute", { name, arguments: { id: 1, confirmed: true }, agent, callId: "call-2", signal } as ToolExecution, async () => ({ kind: "allow" as const }));
    assert.equal((await decide("delete_food_entry", key)).kind, "deny");
    assert.equal((await decide("list_daily_records", key)).kind, "allow");
    assert.equal((await decide("delete_food_entry", {})).kind, "allow");
});

test("预设卸载期间的迟到审批不能放行写入", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    const key = {};
    const scope = createScope(root, key);
    const lifetime = new AbortController();
    root.provide("approval", { request: async (request: any) => {
        assert.equal(request.signal.aborted, false);
        lifetime.abort();
        return "allowed-once";
    } } as any);
    registerFatlossWriteConfirmation(scope.ctx, () => false, lifetime.signal);
    const exec = { name: "add_food_entry", arguments: { name: "苹果" }, agent: {} as Agent, callId: "call-3", signal: new AbortController().signal } as ToolExecution;
    let delegated = false;
    const decision = await root.waterfall(scopeTarget({} as ToolRuntime, key), "tools/pre-execute", exec, async () => { delegated = true; return { kind: "allow" as const }; });
    assert.equal(decision.kind, "cancel");
    assert.equal(delegated, false);
});
