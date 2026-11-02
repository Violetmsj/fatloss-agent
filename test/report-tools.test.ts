import { createPiToolContext } from "../src/pi/tool-context.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import type { ExtensionContext, AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

import { ProfileRepository } from "../src/database.ts";
import { DailyRecordStore } from "../src/daily-record-store.ts";
import { ReportService, REPORT_SUMMARY_PROMPT } from "../src/reports/service.ts";
import { createReportTools } from "../src/tools/reports.ts";
import { createFatlossTools } from "../src/tools/index.ts";
import { presentToolOutput } from "../src/server/tool-presentation.ts";
import { sessionEntriesToUIMessages } from "../src/server/messages.ts";
import { createAgentMessageStream } from "../src/server/agent-stream.ts";
import type { PromptLease } from "../src/server/conversation-registry.ts";
import { reportFood, reportProfile, reportSummary } from "./fixtures/report-data.ts";

test("七个报告工具统一注册，独立模型请求只接收统计并返回已存报告链接", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "report-tools-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
    new DailyRecordStore(repository.db).addFood("2025-01-01", repository.save(reportProfile), { ...reportFood, foodName: "不应进入总结上下文的食物名称" });
    const tools = createReportTools(repository, new ReportService(repository.db, () => Date.parse("2026-10-10T04:00:00Z")));
    const registered = new Set(createFatlossTools(repository).map(tool => tool.name));
    assert.equal(tools.length, 7);
    assert.ok(tools.every(tool => registered.has(tool.name)));
    let requests = 0;
    const ctx = {
        model: { provider: "fake", id: "report" },
        modelRegistry: { complete: async (_model: unknown, context: { systemPrompt: string; messages: { content: string }[] }, options: { signal: AbortSignal }) => {
            requests++;
            assert.equal(context.systemPrompt, REPORT_SUMMARY_PROMPT);
            assert.equal(context.messages.length, 1);
            assert.equal(context.messages[0].content.includes("不应进入总结上下文"), false);
            assert.equal("tools" in context, false);
            assert.ok(options.signal instanceof AbortSignal);
            return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify(reportSummary) }] };
        } },
    } as unknown as ExtensionContext;
    const daily = tools.find(tool => tool.name === "generate_daily_report")!;
    assert.equal(Value.Check(daily.parameters, { date: "2025-01-01" }), true);
    assert.equal(Value.Check(daily.parameters, { date: "2025-01-01", script: "bad" }), false);
    const generated = await daily.execute("daily", { date: "2025-01-01" } as never, undefined, undefined, createPiToolContext(ctx));
    const detail = generated.details as { reportId: string; reportUrl: string };
    assert.match(generated.content[0].type === "text" ? generated.content[0].text : "", /当日能量参考/);
    assert.equal(detail.reportUrl, `/reports/${detail.reportId}`);
    const get = tools.find(tool => tool.name === "get_report")!;
    const read = await get.execute("read", { id: detail.reportId } as never, undefined, undefined, createPiToolContext(ctx));
    assert.deepEqual(read.details, generated.details);
    assert.equal(requests, 1);
    await assert.rejects(() => get.execute("missing", { id: "missing" } as never, undefined, undefined, createPiToolContext(ctx)), /不存在/);
});

test("实时流和 JSONL 历史恢复相同报告链接，原始快照与任意 URL 不会下发", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const name = "generate_yearly_report";
    const result = { content: [{ type: "text", text: "private snapshot" }], details: { reportId: id, summaryStatus: "failed", snapshot: "private snapshot" } };
    const presented = presentToolOutput(name, result);
    assert.equal(presented.reportUrl, `/reports/${id}`);
    assert.equal(JSON.stringify(presented).includes("private"), false);
    assert.match(presented.summary, /总结尚未完成/);
    assert.equal(presentToolOutput(name, { details: { reportId: "../../.env", reportUrl: "https://evil.test" } }).reportUrl, undefined);
    const history = sessionEntriesToUIMessages([
        { type: "message", id: "assistant", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name, arguments: { year: 2025 } }] } },
        { type: "message", id: "result", message: { role: "toolResult", toolCallId: "call", toolName: name, isError: false, ...result } },
    ] as unknown as SessionEntry[]);
    const part = history[0].parts[0];
    assert.equal(part.type, "dynamic-tool");
    if (part.type === "dynamic-tool") assert.deepEqual(part.output, presented);
    let listener: (event: AgentSessionEvent) => void = () => {};
    const lease = {
        session: { subscribe: (callback: typeof listener) => { listener = callback; return () => {}; }, prompt: async () => {
            listener({ type: "tool_execution_end", toolCallId: "call", toolName: name, result, isError: false } as AgentSessionEvent);
        }, abort: async () => {} }, release: () => {}, onNotification: () => () => {},
    } as unknown as PromptLease;
    const chunks = [];
    for await (const chunk of createAgentMessageStream({ lease, prompt: "查看年报", signal: new AbortController().signal })) chunks.push(chunk);
    const output = chunks.find(chunk => chunk.type === "tool-output-available");
    assert.ok(output && output.type === "tool-output-available");
    assert.deepEqual(output.output, presented);
});
