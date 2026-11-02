import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { createUserMessage, createAssistantMessage } from "@deepseek-ai/dsh-llm";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { importData } from "../src/data.ts";
import { FatlossService } from "../src/service.ts";
import { memoryMessage } from "../src/messages.ts";
import { dshTool, schemaForDsh } from "../src/tools.ts";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";
import { reportUrl, reportIdFromUrl } from "../src/report-link.ts";
import { reportProfile, reportFood, reportSummary } from "../../../test/fixtures/report-data.ts";
import { generateText, selectedModel, research } from "../src/runtime.ts";
import { toolContext } from "../src/runtime.ts";
import { MemoryStore } from "../../../src/memory-store.ts";
import { createMemoryTools } from "../../../src/tools/memories.ts";
import { createSearchFatlossKnowledgeTool } from "../../../src/tools/search-fatloss-knowledge.ts";
import { KnowledgeService } from "../../../src/knowledge/service.ts";
import { BILLION_CONTEXT_TOOLS, registerFatlossToolPolicy } from "../src/context-tools.ts";
import { scopeTarget } from "@deepseek-ai/dsh-scope";

function temporary(t: test.TestContext) {
    const path = mkdtempSync(join(tmpdir(), "fatloss-dsh-test-"));
    t.after(() => rmSync(path, { force: true, recursive: true }));
    return path;
}

async function serviceFor(t: test.TestContext) {
    const root = new Context();
    const service = new FatlossService(root, { dataDirectory: temporary(t) });
    t.after(() => root.fiber.dispose());
    return service;
}

const execution = (signal = new AbortController().signal) => ({ agent: {}, callId: "test", signal, concludeTurn() {} }) as unknown as ToolRunContext;

test("一致性导入包含 WAL 数据、参考食物和历史报告，原库后续独立", async t => {
    const source = temporary(t), target = temporary(t);
    const context = new Context();
    const original = new FatlossService(context, { dataDirectory: source });
    t.after(() => context.fiber.dispose());
    original.repository.db.exec("PRAGMA journal_mode=WAL");
    original.repository.save(reportProfile);
    original.records.addFood("2026-10-01", original.repository.get()!, reportFood);
    const report = await original.reports.generate({ type: "daily", date: "2026-10-01" }, { model: "fake", generate: async () => JSON.stringify(reportSummary) });
    mkdirSync(join(source, "reference"));
    copyFileSync(join(import.meta.dirname, "../../../test/fixtures/food-composition.csv"), join(source, "reference/food-composition-full.csv"));
    await importData(source, target);
    assert.ok(existsSync(join(target, "reference/food-composition-full.csv")));
    const destinationContext = new Context();
    const imported = new FatlossService(destinationContext, { dataDirectory: target });
    t.after(() => destinationContext.fiber.dispose());
    assert.equal(imported.reports.get(report.id)?.id, report.id);
    assert.equal(imported.records.getByDate("2026-10-01")?.foodEntries.length, 1);
    imported.repository.update({ weightKg: 90 });
    assert.equal(original.repository.get()!.weightKg, reportProfile.weightKg);
    assert.equal(imported.repository.get()!.weightKg, 90);
    await assert.rejects(importData(source, target), /已存在/);
});

test("无效导入不留下目标数据库，不覆盖已有文件", async t => {
    const source = temporary(t), target = temporary(t);
    await assert.rejects(importData(source, target), /没有找到/);
    const db = new DatabaseSync(join(source, "fatloss.sqlite")); db.close();
    await assert.rejects(importData(source, target));
    assert.equal(existsSync(join(target, "fatloss.sqlite")), false);
});

test("宿主画像预览与取消不写库，保存时校验原有跨字段约束", async t => {
    const service = await serviceFor(t);
    service.preview(reportProfile);
    assert.equal(service.repository.get(), null);
    assert.throws(() => service.save({ ...reportProfile, targetBodyFatPct: 99 }));
    assert.equal(service.repository.get(), null);
    service.save(reportProfile);
    assert.deepEqual(service.repository.get()!.favoriteExercises, reportProfile.favoriteExercises);
    assert.equal("dataDirectory" in service.status(), false);
    assert.equal("embeddingApiKey" in service.status(), false);
});

test("全部业务工具转换为 DSH 协议，食物与运动增改删保留持久化语义", async t => {
    const service = await serviceFor(t);
    service.save(reportProfile);
    const tools = service.tools.map(tool => dshTool(tool, () => ({}), () => service.changed()));
    assert.equal(tools.length, 29);
    assert.ok(tools.every(tool => tool.output.schema && tool.output.render));
    const run = async (name: string, args: unknown) => await tools.find(tool => tool.name === name)!.execute(args, execution()) as { data: any; text: string };
    await assert.rejects(run("add_food_entry", { logDate: "2026-10-01", mealType: "午餐", foodName: "米饭", caloriesKcal: -1 }), /参数无效/);
    const food = await run("add_food_entry", { logDate: "2026-10-01", mealType: "午餐", foodName: "米饭", caloriesKcal: 200 });
    await run("update_food_entry", { id: food.data.id, caloriesKcal: 250 });
    const sport = await run("add_exercise_entry", { logDate: "2026-10-01", exerciseName: "步行", durationMinutes: 30, caloriesBurnedKcal: 100 });
    await run("update_exercise_entry", { id: sport.data.id, durationMinutes: 35 });
    const day = await run("get_daily_record", { logDate: "2026-10-01" });
    assert.equal(day.data.foodEntries[0].caloriesKcal, 250);
    assert.equal(day.data.exerciseEntries[0].durationMinutes, 35);
    await assert.rejects(run("delete_food_entry", { id: food.data.id, confirmed: false }), /参数无效/);
    await run("delete_food_entry", { id: food.data.id, confirmed: true });
    await run("delete_exercise_entry", { id: sport.data.id, confirmed: true });
    await run("delete_daily_record", { logDate: "2026-10-01", confirmed: true });
    assert.equal(service.records.getByDate("2026-10-01"), null);
});

test("DSH schema 展示投影保留联合类型，执行前仍校验完整边界", () => {
    assert.deepEqual(schemaForDsh({ anyOf: [{ type: "number", minimum: 1 }, { type: "null" }] }), { oneOf: [{ type: "number" }, { type: "null" }] });
});

test("真实 DSH 作用域保留预设业务工具，普通聊天看不到减脂工具", async t => {
    const service = await serviceFor(t);
    const root = service.host;
    root.provide("systemPrompt", { tools() {}, section() {} });
    const registry = new ToolRuntime(root);
    const presetKey = {}, agentKey = {}, ordinaryKey = {};
    const preset = createScope(root, presetKey);
    for (const tool of service.tools) preset.ctx.tools.register(dshTool(tool, () => ({}), () => {}));
    const agent = createScope(root, agentKey, { parent: presetKey });
    agent.ctx.tools.presentAs("native");
    registerFatlossToolPolicy(agent.ctx, root, service.tools.map(tool => tool.name));
    assert.equal(registry.schemas(agentKey).length, 29);
    assert.equal(registry.schemas(ordinaryKey).length, 0);
    await agent.dispose(); await preset.dispose();
    assert.equal(registry.schemas(agentKey).length, 0);
});

test("减脂白名单允许 Billion Context 压缩工具，晚注册和重新启用在下一步生效", async t => {
    const service = await serviceFor(t);
    const root = service.host;
    root.provide("systemPrompt", { tools() {}, section() {} });
    const registry = new ToolRuntime(root);
    const presetKey = {}, agentKey = {}, otherKey = {}, researchKey = {};
    const preset = createScope(root, presetKey);
    for (const tool of service.tools) preset.ctx.tools.register(dshTool(tool, () => ({}), () => {}));
    const definition = (name: string) => ({ name, parameters: { type: "object" as const, properties: {} }, output: { schema: { type: "string" as const }, render: () => [] }, execute: async () => "验收" });
    const unrelated = ["bash", "write", "acp_delegate", "acp_future_admin"];
    for (const name of unrelated) root.tools.register(definition(name));
    const agent = createScope(root, agentKey, { parent: presetKey });
    registerFatlossToolPolicy(agent.ctx, root, service.tools.map(tool => tool.name));
    assert.equal(registry.schemas(agentKey).length, 29);
    const registered = BILLION_CONTEXT_TOOLS.map(name => root.tools.register(definition(name)));
    const step = () => root.waterfall(scopeTarget({}, agentKey), "agent/pre-step", { agent: {} as any, signal: new AbortController().signal }, async () => ({ kind: "continue" as const }));
    await step();
    for (const name of BILLION_CONTEXT_TOOLS) assert.ok(registry.get(name, agentKey));
    for (const name of unrelated) assert.equal(registry.get(name, agentKey), undefined);
    assert.equal(registry.get("get_current_profile", otherKey), undefined);
    const research = createScope(root, researchKey, { parent: agentKey });
    research.ctx.tools.restrict({ allow: [] });
    for (const name of BILLION_CONTEXT_TOOLS) assert.equal(registry.get(name, researchKey), undefined);
    registered.forEach(dispose => dispose());
    await step();
    assert.equal(registry.schemas(agentKey).length, 29);
    const reenable = root.tools.register(definition("compress"));
    await step();
    assert.ok(registry.get("compress", agentKey));
    assert.equal((await step()).kind, "continue");
    await research.dispose(); await agent.dispose(); await preset.dispose();
    reenable();
    assert.equal(registry.get("compress", agentKey), undefined);
});

test("报告的五种周期、历史版本与插件导航保持一致", async t => {
    const service = await serviceFor(t); service.save(reportProfile);
    service.records.addFood("2026-10-01", service.repository.get()!, reportFood);
    const tools = service.tools.map(tool => dshTool(tool, () => ({ generateText: async () => JSON.stringify(reportSummary), reportUrl }), () => {}));
    const run = async (name: string, args: unknown) => await tools.find(tool => tool.name === name)!.execute(args, execution()) as { data: any; text: string };
    for (const [name, args] of [
        ["generate_daily_report", { date: "2026-10-01" }], ["generate_weekly_report", { date: "2026-10-01" }],
        ["generate_monthly_report", { month: "2026-10" }], ["generate_yearly_report", { year: 2026 }],
        ["generate_custom_report", { fromDate: "2026-10-01", toDate: "2026-10-02" }],
    ] as const) {
        const result = await run(name, args);
        assert.equal(reportIdFromUrl(result.data.reportUrl), result.data.reportId);
        assert.equal(service.report(result.data.reportId).summaryStatus, "complete");
    }
    const first = await run("generate_daily_report", { date: "2026-10-01" });
    service.records.addFood("2026-10-01", service.repository.get()!, reportFood);
    assert.equal(service.report(first.data.reportId).stale, true);
    const second = await run("generate_daily_report", { date: "2026-10-01", regenerate: true });
    assert.notEqual(first.data.reportId, second.data.reportId);
    assert.equal(service.report(second.data.reportId).versions.length, 2);
    assert.equal(service.listReports({ page: 1, pageSize: 1 }).reports.length, 1);
    assert.equal(reportIdFromUrl("https://example.com/reports/a"), undefined);
});

test("插件停用时取消在途请求并等待结束，迟到结果不能成为成功输出", async t => {
    const service = await serviceFor(t);
    let release!: () => void;
    const task = new Promise<void>(resolve => { release = resolve; });
    const original = service.tools[0]!;
    const tool = dshTool({ ...original, execute: () => service.run(async () => { await task; return { content: [{ type: "text", text: "迟到结果" }], details: {} }; }) }, () => ({}), () => {}, undefined, service.cancellation.signal);
    const pending = tool.execute({}, execution());
    const rejected = assert.rejects(Promise.resolve(pending), /abort/i);
    const dispose = service.host.fiber.dispose();
    await new Promise(resolve => setImmediate(resolve));
    try { assert.equal(service.cancellation.signal.aborted, true); } finally { release(); }
    await rejected; await dispose;
    await assert.rejects(service.run(async () => "不应执行"), /abort/i);
});

test("问卷取消会标记终止当前回合，不产生饮食记录", async t => {
    const service = await serviceFor(t);
    let terminal = false;
    const tool = dshTool(service.tools.find(tool => tool.name === "ask_user")!, () => ({ ask: async () => ({ answers: [], cancelled: true }) }), () => {});
    const exec = execution(); exec.concludeTurn = () => { terminal = true; };
    const result = await tool.execute({ questions: [{ id: "amount", prompt: "多少克？", options: [] }] }, exec) as { data: { cancelled: boolean } };
    assert.equal(result.data.cancelled, true);
    assert.equal(terminal, true);
    assert.equal(service.records.list("2026-10-01", "2026-10-01").length, 0);
});

test("DSH 记忆工具使用真实证据，纠正、失效、删除及过期立即改变当前上下文", async t => {
    const service = await serviceFor(t);
    let now = Date.now() + 1000;
    const store = new MemoryStore(service.repository.db, () => now);
    let source = { id: "dsh:u1", key: "dsh:k1", sessionId: "dsh:one", role: "user" as const, timestamp: new Date(now).toISOString(), text: "请记住我偏爱无糖茶" };
    const tools = createMemoryTools(store).map(tool => dshTool(tool, () => ({ readMessages: () => [source] }), () => {}));
    const run = async (name: string, args: unknown) => await tools.find(tool => tool.name === name)!.execute(args, execution()) as { data: any };
    const fields = (content: string, category = "偏好") => ({ content, category, evidence: [{ messageId: source.id, quote: source.text }], expiresAt: null });
    const created = await run("create_memory", fields("偏爱无糖茶"));
    const id = created.data.ids[0];
    assert.match(store.context(), /偏爱无糖茶/);
    now += 1000; source = { ...source, id: "dsh:u2", key: "dsh:k2", timestamp: new Date(now).toISOString(), text: "纠正一下，我偏爱白水" };
    await run("update_memory", { id, version: 1, ...fields("偏爱白水") });
    assert.match(store.context(), /偏爱白水/); assert.doesNotMatch(store.context(), /偏爱无糖茶/);
    await run("invalidate_memory", { id, version: 2, evidence: [{ messageId: source.id, quote: source.text }] });
    assert.doesNotMatch(store.context(), /偏爱白水/);
    const listed = await run("list_memories", { id, status: "all" });
    await run("delete_memory", { id, version: listed.data.items[0].version });
    assert.equal((await run("list_memories", { id, status: "all" })).data.total, 0);
    now += 1000; source = { ...source, id: "dsh:u3", key: "dsh:k3", timestamp: new Date(now).toISOString(), text: "这几天我临时出差" };
    await run("create_memory", fields("临时出差", "阶段状态"));
    now += 8 * 86400_000;
    assert.doesNotMatch(store.context(), /临时出差/);
});

test("DSH 检索保留知识来源，原生问卷不能绕过禁止自由输入的约束", async () => {
    const knowledge = new KnowledgeService({ embedQuery: async () => [1], embedDocuments: async () => [] }, {
        replaceSource: async () => {}, search: async () => [{ id: "fixture", sourceId: "fixture", sourceFile: "fixture.md", questionNumber: 1, question: "验收知识", chunkIndex: 0, document: "固定测试知识", contentHash: "fixture", distance: 0 }],
    });
    const search = dshTool(createSearchFatlossKnowledgeTool(knowledge), () => ({}), () => {});
    assert.match((await search.execute({ question: "测试" }, execution()) as { text: string }).text, /参考知识库：1. 验收知识/);
    const agent = { options: {}, session: { requestHeader: () => undefined }, inject() { throw new Error("无效自由输入不得写入证据"); } } as any;
    const context = toolContext({ userQuestions: { ask: async () => ({ answers: [{ id: "one", selected: [], custom: "未提供的选项" }] }) } } as any, agent, () => [], "call");
    assert.equal((await context.ask!([{ id: "one", prompt: "选择", options: [{ value: "yes", label: "是" }], allowOther: false }])).cancelled, true);
    agent.inject = () => {};
    const free = toolContext({ userQuestions: { ask: async () => ({ answers: [{ id: "one", selected: [], custom: "是" }] }) } } as any, agent, () => [], "call");
    const reply = await free.ask!([{ id: "one", prompt: "选择", options: [{ value: "yes", label: "是" }], allowOther: true }]);
    assert.equal(reply.answers[0]!.wasCustom, true); assert.equal(reply.answers[0]!.value, "是");
});

test("普通通知和插件快照不能成为用户证据，分叉保持来源去重键", () => {
    const user = createUserMessage({ content: [{ type: "text", text: "我喜欢散步" }], source: { kind: "user" } });
    const event = { type: "user/message", seq: 0, time: 1000, surfaceOp: "append", data: user } as unknown as SessionEvent;
    assert.equal(memoryMessage(event, "one")?.id, `dsh:${user.id}`);
    assert.equal(memoryMessage(event, "one")?.key, memoryMessage(event, "fork")?.key);
    const notification = { ...event, data: { ...user, source: { kind: "system-prompt" } } } as SessionEvent;
    assert.equal(memoryMessage(notification, "one"), undefined);
    assert.equal(memoryMessage({ ...event, surfaceOp: { op: "replace", from: 0, to: 1 } } as unknown as SessionEvent, "one"), undefined);
});

test("辅助模型使用当前请求模型，拒绝不完整输出并传递取消信号", async () => {
    const agent = { options: { provider: "old", model: "old" }, session: { requestHeader: () => ({ config: { provider: "current", model: "new" } }) } } as any;
    assert.equal(selectedModel(agent)?.model, "new");
    const controller = new AbortController();
    let captured: any;
    const ctx = { llm: { async *stream(input: unknown) { captured = input; yield { type: "text-delta", text: "结果" }; yield { type: "finish", reason: { kind: "stop" } }; } } } as any;
    assert.equal(await generateText(ctx, agent, "规则", "统计", controller.signal), "结果");
    assert.equal(captured.model, "new"); assert.equal(captured.signal, controller.signal);
    assert.equal(captured.tools, undefined);
    const firstId = captured.sessionId;
    assert.match(firstId, /^fatloss-aux-/);
    await generateText(ctx, agent, "规则", "第二次统计", controller.signal);
    assert.notEqual(captured.sessionId, firstId);
    ctx.llm.stream = async function* () { yield { type: "finish", reason: { kind: "length" } }; };
    await assert.rejects(generateText(ctx, agent, "规则", "统计", controller.signal), /完整/);
});

test("检索子 Agent 无主聊天和写库工具，完成与取消都释放句柄", async () => {
    let configuration: any, disposed = 0;
    const restriction: unknown[] = [], registered: unknown[] = [], prompts: any[] = [];
    const search = { name: "web_search" };
    let guard: (execution: any) => string | undefined = () => undefined;
    const root = { tools: { get: () => search }, agents: { create: async (config: any) => {
        configuration = config;
        config.setup({ tools: { presentAs() {}, restrict: (value: unknown) => restriction.push(value), register: (value: unknown) => registered.push(value), guard: (value: typeof guard) => { guard = value; } }, systemPrompt: { suppressRuntimeContext() {}, section() {} } });
        return { agent: { followup: (value: unknown) => prompts.push(value), whenIdle: async () => {}, cancel() {}, session: { deriveMessages: () => [createAssistantMessage({ content: [{ type: "text", text: "{}" }], source: { kind: "model", provider: "test", model: "test" } })] } }, dispose: async () => { disposed++; } };
    } } };
    const parent = { options: { provider: "test", model: "test" }, session: { requestHeader: () => undefined } } as any;
    assert.equal(await research({ fatloss: { host: root } } as any, parent, "公开食物描述"), "{}");
    assert.deepEqual(restriction, [{ allow: [] }]); assert.deepEqual(registered, [search]);
    assert.ok(guard({ name: "add_food_entry" })); assert.equal(guard({ name: "web_search" }), undefined);
    assert.equal(configuration.seed, undefined); assert.equal(prompts.length, 1); assert.equal(disposed, 1);
});
