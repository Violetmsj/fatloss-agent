import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";

import { ProfileRepository } from "../../src/core/database.ts";
import { DailyRecordStore } from "../../src/core/daily-record-store.ts";
import { ReportService, REPORT_SUMMARY_PROMPT } from "../../src/core/reports/service.ts";
import { createReportTools } from "../../src/core/tools/reports.ts";
import { createFatlossTools } from "../../src/core/tools/index.ts";
import { reportFood, reportProfile, reportSummary } from "../fixtures/report-data.ts";

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
        modelName: "fake/report",
        reportUrl: (id: string) => `https://fatloss.localhost/reports/${id}`,
        generateText: async (systemPrompt: string, input: string, signal: AbortSignal) => {
            requests++;
            assert.equal(systemPrompt, REPORT_SUMMARY_PROMPT);
            assert.equal(input.includes("不应进入总结上下文"), false);
            assert.ok(signal instanceof AbortSignal);
            return JSON.stringify(reportSummary);
        },
    };
    const daily = tools.find(tool => tool.name === "generate_daily_report")!;
    assert.equal(Value.Check(daily.parameters, { date: "2025-01-01" }), true);
    assert.equal(Value.Check(daily.parameters, { date: "2025-01-01", script: "bad" }), false);
    const generated = await daily.execute("daily", { date: "2025-01-01" } as never, undefined, undefined, ctx);
    const detail = generated.details as { reportId: string; reportUrl: string };
    assert.match(generated.content[0].type === "text" ? generated.content[0].text : "", /当日能量参考/);
    assert.equal(detail.reportUrl, `https://fatloss.localhost/reports/${detail.reportId}`);
    const get = tools.find(tool => tool.name === "get_report")!;
    const read = await get.execute("read", { id: detail.reportId } as never, undefined, undefined, ctx);
    assert.deepEqual(read.details, generated.details);
    assert.equal(requests, 1);
    await assert.rejects(() => get.execute("missing", { id: "missing" } as never, undefined, undefined, ctx), /不存在/);
});

