import type { Agent } from "@deepseek-ai/dsh-agent";
import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { scopeTarget, createScope } from "@deepseek-ai/dsh-scope";
import { registerFatlossCompactionReady } from "../../src/host/compaction-ready.ts";

test("没有 Billion 时立即允许减脂预设加载，Basic 自动钩子只在本预设运行", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    root.provide("profileContext", { startedBundles: ["dsh-plugin-fatloss-agent"] } as any);
    registerFatlossCompactionReady(root);
    assert.equal(root.get("fatlossCompactionReady"), true);
    const key = {}, ordinary = {};
    const preset = createScope(root, key).ctx.isolate("compaction");
    const engine = new BasicCompactionEngine(preset);
    assert.equal(engine.config.auto, true);
    assert.equal(root.get("compaction"), undefined);
    const triggers: string[] = [];
    engine.compactIfNeeded = async (_agent, trigger) => { triggers.push(trigger); return null; };
    const signal = new AbortController().signal;
    const step = (scope: object) => root.waterfall(scopeTarget({} as Agent, scope), "agent/pre-step", { agent: {} as Agent, messages: [], turn: 1, step: 1, signal }, async () => ({ kind: "enter" as const, messages: [] }));
    await step(ordinary);
    assert.deepEqual(triggers, []);
    await step(key);
    assert.deepEqual(triggers, ["pressure"]);
    await step(key);
    assert.deepEqual(triggers, ["pressure", "pressure"]);
    await preset.fiber.dispose();
    await step(key);
    assert.equal(triggers.length, 2);
});

test("Billion 协调器晚加载时预设等待，就绪后才允许装配", async t => {
    const root = new Context();
    t.after(() => root.fiber.dispose());
    root.provide("profileContext", { startedBundles: ["billion-context", "dsh-plugin-fatloss-agent"] } as any);
    let mounted = false;
    registerFatlossCompactionReady(root);
    const preset = await root.inject(["fatlossCompactionReady"], () => { mounted = true; });
    assert.equal(mounted, false);
    assert.equal(root.get("fatlossCompactionReady"), undefined);
    await root.plugin({ apply(ctx) { ctx.provide("biliBasicCompactionPolicy", { owner: "billion-context" }); } });
    await preset;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(root.get("fatlossCompactionReady"), true);
    assert.equal(mounted, true);
});
