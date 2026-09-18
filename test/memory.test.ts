import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { ProfileRepository } from "../src/database.ts";
import { MemoryConflictError, MemoryStore } from "../src/memory-store.ts";
import { MemoryCoordinator, readMemoryMessages, registerMemoryRuntime, type ScheduleMemoryTask } from "../src/memory-runtime.ts";
import { type MemoryCandidate, type MemoryMessage } from "../src/memory.ts";
import { createFatlossTools } from "../src/tools/index.ts";
import { createMemoryTools } from "../src/tools/memories.ts";

const START = Date.parse("2026-09-18T08:00:00+08:00");
function setup(t: { after: (run: () => void) => void }) {
    const directory = mkdtempSync(join(tmpdir(), "fatloss-memory-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    let now = START;
    const store = new MemoryStore(repository.db, () => now);
    t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
    return { repository, store, setNow: (value: number) => { now = value; } };
}

function message(id = "u1", text = "我不喜欢跑步，更愿意散步", time = START + 1000): MemoryMessage {
    return { id, key: `key-${id}`, sessionId: "session-1", role: "user", text, timestamp: new Date(time).toISOString() };
}
function create(source = message(), content = "不喜欢跑步，更愿意散步"): MemoryCandidate {
    return { action: "create", content, category: "偏好", evidence: [{ messageId: source.id, quote: source.text }], expiresAt: null };
}

test("空候选推进处理进度，恢复仓储后也不重复处理", (t) => {
    const { store, repository } = setup(t);
    const source = message();
    const revision = store.revision;
    assert.equal(store.pending([source]).length, 1);
    const result = store.apply([], [source], revision, [source]);
    assert.equal(result.created, 0);
    assert.equal(store.revision, revision);
    const restored = new MemoryStore(repository.db, () => START + 10000);
    assert.equal(restored.enabledAt, store.enabledAt);
    assert.deepEqual(restored.pending([source]), []);
});

test("只处理启用后的用户原始消息，助手消息不计轮数", (t) => {
    const { store } = setup(t);
    assert.deepEqual(store.pending([
        message("old", "旧历史", START - 1), message(), { ...message("assistant"), role: "assistant" },
    ]).map((item) => item.id), ["u1"]);
});

test("记住明确偏好、跨会话读取、纠正后只注入新内容", (t) => {
    const { store, repository, setNow } = setup(t);
    const source = message();
    const { ids: [id] } = store.apply([create()], [source], store.revision, [source]);
    assert.ok(store.context().includes("不喜欢跑步，更愿意散步"));
    const restored = new MemoryStore(repository.db, store.now);
    assert.equal(restored.list().items[0].id, id);
    setNow(START + 20000);
    const correction = message("u2", "纠正一下，我更喜欢游泳", START + 15000);
    store.apply([{ ...create(correction, "更喜欢游泳"), action: "update", id }], [correction], store.revision);
    const saved = store.list().items[0];
    assert.equal(saved.content, "更喜欢游泳");
    assert.equal(saved.version, 2);
    assert.equal(saved.basis, "explicit");
    assert.ok(store.context().includes('"content":"更喜欢游泳"'));
    assert.ok(!store.context().includes('"content":"不喜欢跑步，更愿意散步"'));
});

test("重复陈述不重复新增，也不触发无意义的变更", (t) => {
    const { store } = setup(t);
    store.apply([create()], [message()], store.revision);
    const next = message("u2");
    const result = store.apply([create(next)], [next], store.revision, [next]);
    assert.equal(result.created, 0);
    assert.equal(store.list().total, 1);
    assert.deepEqual(store.pending([next]), []);
});

test("伪造原话或助手来源会使整批回滚，保留处理进度", (t) => {
    const { store } = setup(t);
    const source = message();
    const forged = { ...create(), evidence: [{ messageId: source.id, quote: "我喜欢举铁" }] };
    assert.throws(() => store.apply([create(), forged], [source], store.revision, [source]), /真实用户消息/);
    assert.equal(store.list().total, 0);
    assert.equal(store.pending([source]).length, 1);
    assert.throws(() => store.apply([create()], [{ ...source, role: "assistant" }], store.revision), /真实用户消息/);
});

test("非法结构、推断依据、自动删除和空白内容都不能写入", (t) => {
    const { store } = setup(t);
    for (const value of [{ summary: "摘要" }, [{ ...create(), basis: "inferred" }], [{ action: "delete", id: "x" }], [{ ...create(), content: " " }]]) {
        assert.throws(() => store.apply(value, [message()], store.revision));
    }
    assert.equal(store.list().total, 0);
});

test("无期限阶段状态从原话起七天失效，偏好不自动过期", (t) => {
    const { store, setNow } = setup(t);
    const source = message("u1", "最近加班，只能晚上运动");
    store.apply([{ ...create(source, source.text), category: "阶段状态" }, create(message("u2"))], [source, message("u2")], store.revision);
    const state = store.list({ category: "阶段状态" }).items[0];
    assert.equal(state.expiresAt, new Date(START + 1000 + 7 * 86400000).toISOString());
    setNow(START + 1000 + 7 * 86400000);
    assert.equal(store.list({ category: "阶段状态" }).total, 0);
    assert.equal(store.list({ category: "阶段状态", status: "inactive" }).total, 1);
    assert.equal(store.list({ category: "偏好" }).total, 1);
    assert.ok(!store.context().includes("最近加班"));
});

test("明确期限按时区保存，非法或早于原话的期限拒绝入库", (t) => {
    const { store } = setup(t);
    store.apply([{ ...create(), expiresAt: "2026-09-20T00:00:00+08:00" }], [message()], store.revision);
    assert.equal(store.list().items[0].expiresAt, "2026-09-19T16:00:00.000Z");
    for (const expiresAt of ["明天", "2026-09-21T00:00:00", "2026-09-18T00:00:00Z", "2027-02-30T00:00:00Z"]) {
        assert.throws(() => store.apply([{ ...create(), expiresAt }], [message()], store.revision));
    }
});

test("失效保留记录但不进入回复上下文", (t) => {
    const { store } = setup(t);
    const { ids: [id] } = store.apply([create()], [message()], store.revision);
    const source = message("u2", "这个偏好已经不适用了");
    store.apply([{ action: "invalidate", id, evidence: [{ messageId: source.id, quote: source.text }] }], [source], store.revision);
    assert.equal(store.list().total, 0);
    assert.equal(store.list({ status: "all" }).total, 1);
    assert.ok(!store.context().includes("散步"));
});

test("删除清除正文与原话，旧来源及旧后台快照不能恢复，未来新陈述仍可保存", (t) => {
    const { store, repository } = setup(t);
    const source = message();
    const { ids: [id] } = store.apply([create()], [source], store.revision);
    const oldRevision = store.revision;
    store.delete(id, 1);
    assert.equal(store.list({ status: "all" }).total, 0);
    assert.ok(!store.context().includes("散步"));
    assert.deepEqual(store.pending([source]), []);
    assert.throws(() => store.apply([create()], [source], oldRevision), MemoryConflictError);
    assert.throws(() => store.apply([create()], [source], store.revision), /忘记/);
    const forgotten = repository.db.prepare("SELECT * FROM memory_forgotten_sources").all();
    assert.deepEqual(Object.keys(forgotten[0]), ["source_key"]);
    const future = message("u3");
    assert.equal(store.apply([create(future)], [future], store.revision).created, 1);
});

test("版本冲突、无效 ID 和重复修改目标不能部分提交", (t) => {
    const { store } = setup(t);
    const { ids: [id] } = store.apply([create()], [message()], store.revision);
    assert.throws(() => store.delete(id, 99), MemoryConflictError);
    const candidate = { ...create(), action: "update" as const, id, content: "更喜欢游泳" };
    assert.throws(() => store.apply([candidate, candidate], [message()], store.revision), /同一批次/);
    assert.throws(() => store.apply([{ ...candidate, id: "missing" }], [message()], store.revision), /不存在/);
    assert.equal(store.list().items[0].version, 1);
});

test("积压的旧原话不能覆盖用户的新纠正，删除同时屏蔽整条来源链", (t) => {
    const { store } = setup(t);
    const original = message();
    const { ids: [id] } = store.apply([create()], [original], store.revision);
    const newer = message("u2", "现在喜欢游泳", START + 10000);
    store.apply([{ ...create(newer, newer.text), action: "update", id }], [newer], store.revision);
    assert.throws(() => store.apply([{ ...create(), action: "update", id }], [original], store.revision), /较早的陈述/);
    assert.equal(store.list().items[0].content, newer.text);
    store.delete(id, 2);
    assert.deepEqual(store.pending([original, newer]), []);
});

test("查询支持文本类别状态分页，上下文限制条数和字符并提示查询", (t) => {
    const { store } = setup(t);
    const sources = Array.from({ length: 35 }, (_, i) => message(`u${i}`, `偏好记录${i}`));
    store.apply(sources.map((source) => create(source, source.text)), sources, store.revision);
    assert.equal(store.list({ text: "记录3" }).total, 6);
    assert.equal(store.list({ category: "阶段状态" }).total, 0);
    assert.equal(store.list({ limit: 2, offset: 2 }).items.length, 2);
    assert.ok(store.context().length <= 6000);
    assert.ok(store.context().includes("未完整加载"));
});

class FakeClock {
    now = 0;
    jobs = new Map<number, { at: number; run: () => void }>();
    serial = 0;
    schedule: ScheduleMemoryTask = (run, delay) => {
        const id = ++this.serial;
        this.jobs.set(id, { at: this.now + delay, run });
        return () => { this.jobs.delete(id); };
    };
    async advance(delay: number) {
        this.now += delay;
        for (const [id, job] of [...this.jobs]) {
            if (job.at <= this.now && this.jobs.delete(id)) job.run();
        }
        await tick();
    }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function coordinatorSetup(t: { after: (run: () => void) => void }, count = 1) {
    const data = setup(t);
    const clock = new FakeClock();
    let messages = Array.from({ length: count }, (_, i) => message(`u${i}`));
    let idle = true;
    let calls = 0;
    let received = "";
    const notices: string[] = [];
    let extract = async (_input: string, _signal: AbortSignal) => "[]";
    const coordinator = new MemoryCoordinator({
        store: data.store, schedule: clock.schedule, readMessages: () => messages,
        getProfile: () => ({ weightKg: 80 }), isIdle: () => idle,
        extract: (input, signal) => { calls++; received = input; return extract(input, signal); },
        notify: (text) => notices.push(text),
    });
    t.after(() => coordinator.stop());
    return {
        ...data, clock, coordinator, notices,
        get calls() { return calls; }, get received() { return received; },
        get messages() { return messages; },
        setMessages: (value: MemoryMessage[]) => { messages = value; },
        setIdle: (value: boolean) => { idle = value; },
        setExtract: (value: typeof extract) => { extract = value; },
    };
}

test("十条用户发言在回答结束后触发，空结果静默且输入包含原话和资料", async (t) => {
    const data = coordinatorSetup(t, 10);
    data.coordinator.settled();
    await tick();
    assert.equal(data.calls, 1);
    assert.equal(data.store.pending(data.messages).length, 0);
    assert.deepEqual(data.notices, []);
    const input = JSON.parse(data.received);
    assert.equal(input.pendingMessageIds.length, 10);
    assert.equal(input.context[0].text, data.messages[0].text);
    assert.equal(input.profile.weightKg, 80);
});

test("不足十轮空闲五分钟触发，新输入重置计时，忙碌时延后", async (t) => {
    const data = coordinatorSetup(t);
    data.coordinator.settled();
    await data.clock.advance(240000);
    data.coordinator.input();
    await data.clock.advance(60000);
    assert.equal(data.calls, 0);
    data.coordinator.settled();
    data.setIdle(false);
    await data.clock.advance(300000);
    assert.equal(data.calls, 0);
    data.setIdle(true);
    await data.clock.advance(300000);
    assert.equal(data.calls, 1);
});

test("模型产生合格候选才入库并简短提示", async (t) => {
    const data = coordinatorSetup(t);
    data.setExtract(async () => JSON.stringify([create(data.messages[0])]));
    await data.coordinator.flush();
    assert.equal(data.store.list().total, 1);
    assert.equal(data.notices.length, 1);
    assert.match(data.notices[0], /新增 1 条/);
});

test("非法模型输出或请求失败不推进进度，也不自动循环请求", async (t) => {
    for (const output of ["不是 JSON", '[{"action":"delete","id":"x"}]']) {
        const data = coordinatorSetup(t);
        data.setExtract(async () => output);
        await data.coordinator.flush();
        assert.equal(data.store.pending(data.messages).length, 1);
        await data.clock.advance(600000);
        assert.equal(data.calls, 1);
        assert.equal(data.notices.length, 1);
    }
    const data = coordinatorSetup(t);
    data.setExtract(async () => { throw new Error("网络不可用"); });
    await data.coordinator.flush();
    assert.equal(data.store.pending(data.messages).length, 1);
});

test("同时触发只请求一次，六十秒超时后晚到结果不能写入", async (t) => {
    const data = coordinatorSetup(t);
    let resolve!: (value: string) => void;
    data.setExtract(() => new Promise((done) => { resolve = done; }));
    const first = data.coordinator.flush();
    assert.equal(data.coordinator.flush(), first);
    assert.equal(data.calls, 1);
    await data.clock.advance(60000);
    await first;
    resolve(JSON.stringify([create(data.messages[0])]));
    await tick();
    assert.equal(data.store.list().total, 0);
    assert.equal(data.store.pending(data.messages).length, 1);
});

test("用户删除使在途提取冲突，不能复活记忆", async (t) => {
    const data = coordinatorSetup(t);
    const { ids: [id] } = data.store.apply([create(data.messages[0])], [data.messages[0]], data.store.revision);
    let resolve!: (value: string) => void;
    data.setExtract(() => new Promise((done) => { resolve = done; }));
    const run = data.coordinator.flush();
    data.store.delete(id, 1);
    resolve(JSON.stringify([create(data.messages[0])]));
    await run;
    assert.equal(data.store.list({ status: "all" }).total, 0);
    assert.match(data.notices[0], /记忆已发生变更/);
});

test("停止及切换会话取消任务且不向新会话写入旧结果", async (t) => {
    const data = coordinatorSetup(t);
    let resolve!: (value: string) => void;
    data.setExtract(() => new Promise((done) => { resolve = done; }));
    const run = data.coordinator.flush();
    const old = data.messages[0];
    data.coordinator.stop();
    data.setMessages([{ ...message("new"), sessionId: "session-2" }]);
    data.coordinator.resume();
    resolve(JSON.stringify([create(old)]));
    await run;
    assert.equal(data.store.list().total, 0);
    assert.deepEqual(data.notices, []);
    data.setExtract(async () => "[]");
    await data.coordinator.flush();
    assert.equal(data.store.pending([old]).length, 1);
    assert.equal(data.store.pending(data.messages).length, 0);
});

function entry(id: string, role: "user" | "assistant", text: string): SessionEntry {
    // 此处只使用消息文本；无关的模型 usage 字段不参与被测适配器。
    return { id, parentId: null, type: "message", timestamp: new Date(START + 1000).toISOString(),
        message: { role, content: role === "user" ? text : [{ type: "text", text }], timestamp: START + 1000 },
    } as SessionEntry;
}

test("会话适配器仅取原始人机文本，分叉继承消息具有相同防重放标识", () => {
    const entries = [entry("u1", "user", "原话"), entry("a1", "assistant", "回答"),
        { id: "c1", type: "compaction", summary: "摘要不得变成用户证据" } as SessionEntry,
        { id: "t1", type: "message", message: { role: "toolResult", content: [{ type: "text", text: "工具结果" }] } } as SessionEntry];
    const original = readMemoryMessages(entries, "original");
    const fork = readMemoryMessages(entries, "fork");
    assert.equal(original.length, 2);
    assert.equal(original[0].key, fork[0].key);
    assert.equal(original[0].text, "原话");
});

test("五种记忆工具注册，直接写入只接受当前用户证据及正确版本", async (t) => {
    const { store, repository } = setup(t);
    const tools = createMemoryTools(store);
    const all = createFatlossTools(repository, store).map((tool) => tool.name);
    for (const tool of tools) assert.ok(all.includes(tool.name));
    assert.equal(tools.length, 5);
    const entries = [entry("old", "user", "旧话"), entry("u1", "user", "请记住，我不喜欢被催促")];
    const ctx = { sessionManager: { getBranch: () => entries, getSessionId: () => "session" } } as unknown as ExtensionContext;
    const run = (name: string, args: unknown) => tools.find((tool) => tool.name === name)!.execute("call", args as never, undefined, undefined, ctx);
    await assert.rejects(run("create_memory", { content: "旧话", category: "偏好", evidence: [{ messageId: "old", quote: "旧话" }] }), /真实用户/);
    await run("create_memory", { content: "不喜欢被催促", category: "偏好", evidence: [{ messageId: "u1", quote: "不喜欢被催促" }] });
    const saved = store.list().items[0];
    await assert.rejects(run("update_memory", { id: saved.id, version: 99, content: "新偏好", category: "偏好", evidence: [{ messageId: "u1", quote: "不喜欢被催促" }] }), MemoryConflictError);
    await run("delete_memory", { id: saved.id, version: saved.version });
    assert.equal(store.list().total, 0);
});

test("context 每次加载最新有效记忆，不修改原消息或持久化临时快照", async (t) => {
    const { store, repository } = setup(t);
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
    const commands = new Map<string, unknown>();
    const pi = { on: (name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, fn),
        registerCommand: (name: string, command: unknown) => commands.set(name, command),
    } as unknown as ExtensionAPI;
    registerMemoryRuntime(pi, store, repository);
    assert.ok(commands.has("memories"));
    const entries = [entry("u1", "user", "请根据我的偏好给个建议")];
    const ctx = { sessionManager: { getBranch: () => entries, getSessionId: () => "session" } } as unknown as ExtensionContext;
    const { ids: [id] } = store.apply([create()], [message()], store.revision);
    const event = { messages: [{ role: "user", content: "请给个建议" }] };
    const first = handlers.get("context")!(event, ctx) as { messages: { content: string }[] };
    assert.equal(event.messages.length, 1);
    assert.equal(first.messages.length, 2);
    assert.ok(first.messages[1].content.includes("散步"));
    store.delete(id, 1);
    const second = handlers.get("context")!(event, ctx) as { messages: { content: string }[] };
    assert.equal(second.messages.length, 2);
    assert.ok(!second.messages[1].content.includes("散步"));
});

test("SDK 生命周期通过独立当前模型请求提取，工具结果不参与计数或证据", async (t) => {
    const { store, repository } = setup(t);
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
    const pi = { on: (name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, fn), registerCommand: () => {} } as unknown as ExtensionAPI;
    registerMemoryRuntime(pi, store, repository);
    const entries = Array.from({ length: 10 }, (_, i) => entry(`u${i}`, "user", `知识问题${i}`));
    let calls = 0;
    const selectedModel = { id: "fake-model" };
    const ctx = {
        sessionManager: { getBranch: () => entries, getSessionId: () => "sdk-session" },
        isIdle: () => true, hasPendingMessages: () => false, model: selectedModel,
        ui: { notify: () => assert.fail("空结果不应提示") },
        modelRegistry: { complete: async (model: unknown, input: { systemPrompt: string; messages: { content: string }[] }, options: { signal: AbortSignal }) => {
            calls++;
            assert.equal(model, selectedModel);
            assert.ok(options.signal instanceof AbortSignal);
            assert.ok(input.systemPrompt.includes("只输出 JSON 数组"));
            assert.equal(JSON.parse(input.messages[0].content).pendingMessageIds.length, 10);
            return { content: [{ type: "text", text: "[]" }], stopReason: "stop" };
        } },
    } as unknown as ExtensionContext;
    t.after(() => handlers.get("session_shutdown")!({}, ctx));
    handlers.get("session_start")!({}, ctx);
    handlers.get("agent_settled")!({}, ctx);
    await tick();
    assert.equal(calls, 1);
    assert.equal(store.pending(readMemoryMessages(entries, "sdk-session")).length, 0);
});
