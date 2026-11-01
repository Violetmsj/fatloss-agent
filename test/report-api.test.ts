import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileRepository } from "../src/database.ts";
import { DailyRecordStore } from "../src/daily-record-store.ts";
import { ReportService } from "../src/reports/service.ts";
import { createServerApp } from "../src/server/app.ts";
import type { ConversationSessionRegistry } from "../src/server/conversation-registry.ts";
import type { ReportList, ReportView } from "../src/reports/types.ts";
import { reportFood, reportProfile, reportSummary } from "./fixtures/report-data.ts";

test("报告 API 支持筛选分页、历史详情和 Markdown，非法请求返回 400/404", async () => {
    const directory = mkdtempSync(join(tmpdir(), "report-api-"));
    const repository = new ProfileRepository(join(directory, "test.sqlite"));
    const records = new DailyRecordStore(repository.db);
    records.addFood("2025-01-01", repository.save(reportProfile), reportFood);
    const service = new ReportService(repository.db);
    const generator = { model: "fake/report", generate: async () => JSON.stringify(reportSummary) };
    const first = await service.generate({ type: "monthly", month: "2025-01" }, generator);
    records.addFood("2025-01-02", repository.get()!, reportFood);
    const second = await service.generate({ type: "monthly", month: "2025-01", regenerate: true }, generator);
    const { app } = createServerApp({ profiles: repository, registry: {} as ConversationSessionRegistry, webDistPath: join(directory, "no-dist") });
    const server = createServer(app);
    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const base = `http://127.0.0.1:${address.port}`;
        const list = await (await fetch(`${base}/api/reports?type=monthly&fromDate=2025-01-01&toDate=2025-01-31&pageSize=1`)).json() as ReportList;
        assert.equal(list.total, 2);
        assert.equal(list.reports.length, 1);
        assert.equal(list.reports[0].id, second.id);
        assert.equal("snapshot" in list.reports[0], false);
        const old = await (await fetch(`${base}/api/reports/${first.id}`)).json() as ReportView;
        assert.equal(old.stale, true);
        assert.equal(old.statistics.totals.foodDays, 1);
        assert.equal(old.versions.length, 2);
        const markdown = await fetch(`${base}/api/reports/${first.id}/markdown`);
        assert.match(markdown.headers.get("content-type")!, /text\/markdown/);
        assert.match(markdown.headers.get("content-disposition")!, /v1.md/);
        assert.equal(await markdown.text(), first.markdown);
        for (const query of ["type=wrong", "page=0", "pageSize=51", "fromDate=2025-02-30", "type=monthly&type=daily"]) {
            assert.equal((await fetch(`${base}/api/reports?${query}`)).status, 400);
        }
        assert.equal((await fetch(`${base}/api/reports/missing`)).status, 404);
        assert.equal((await fetch(`${base}/api/reports/missing/markdown`)).status, 404);
    } finally {
        if (server.listening) { server.close(); await once(server, "close"); }
        repository.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
