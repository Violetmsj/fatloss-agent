import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import { ownAgentEffects } from "../../src/host/agent-effects.ts";

test("Agent 释放和预设卸载都只清理一次会话级资源", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    const presetKey = {};
    const preset = createScope(root, presetKey);
    const first = createScope(root, {}, { parent: presetKey });
    const second = createScope(root, {}, { parent: presetKey });
    const own = ownAgentEffects(preset.ctx);
    const stopped: string[] = [];
    const registrations: string[] = [];
    own(first.ctx, () => { const release = first.ctx.effect(() => () => { registrations.push("first"); }); return async () => { stopped.push("first"); await release(); }; });
    own(second.ctx, () => { const release = second.ctx.effect(() => () => { registrations.push("second"); }); return async () => { stopped.push("second"); await release(); }; });
    await first.dispose();
    assert.deepEqual(stopped, ["first"]);
    assert.deepEqual(registrations, ["first"]);
    await preset.dispose();
    assert.deepEqual(stopped, ["first", "second"]);
    assert.deepEqual(registrations, ["first", "second"]);
    await second.dispose();
    assert.deepEqual(stopped, ["first", "second"]);
});
