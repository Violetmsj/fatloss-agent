import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { validateRecordDate } from "../daily-record.ts";
import { renderReportMarkdown } from "./markdown.ts";
import { REPORT_TYPES, type ReportFilter, type ReportList, type ReportMetadata, type ReportSnapshot, type ReportStatistics, type ReportSummary, type SavedReport } from "./types.ts";

export function initializeReportSchema(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
            from_date TEXT NOT NULL,
            to_date TEXT NOT NULL,
            cutoff_date TEXT NOT NULL,
            ongoing INTEGER NOT NULL,
            version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            statistics_json TEXT NOT NULL,
            summary_json TEXT,
            summary_status TEXT NOT NULL CHECK (summary_status IN ('pending', 'complete', 'failed', 'not_applicable')),
            summary_error TEXT,
            model TEXT,
            schema_version INTEGER NOT NULL,
            template_version INTEGER NOT NULL,
            markdown TEXT NOT NULL,
            lease_token TEXT,
            lease_expires_at INTEGER,
            UNIQUE(type, from_date, to_date, version)
        );
        CREATE INDEX IF NOT EXISTS reports_period ON reports(type, from_date, to_date, version DESC);
        CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at DESC);
    `);
}

type ReportRow = Record<string, unknown>;

function metadata(row: ReportRow): ReportMetadata {
    return {
        id: String(row.id), type: row.type as ReportMetadata["type"], fromDate: String(row.from_date), toDate: String(row.to_date),
        cutoffDate: String(row.cutoff_date), ongoing: !!row.ongoing, version: Number(row.version), createdAt: String(row.created_at),
        summaryStatus: row.summary_status as ReportMetadata["summaryStatus"], model: row.model as string | null,
        schemaVersion: Number(row.schema_version), templateVersion: Number(row.template_version),
    };
}

function savedReport(row: ReportRow): SavedReport {
    return {
        ...metadata(row), sourceFingerprint: String(row.source_fingerprint), snapshot: JSON.parse(String(row.snapshot_json)),
        statistics: JSON.parse(String(row.statistics_json)), summary: row.summary_json ? JSON.parse(String(row.summary_json)) : null,
        summaryError: row.summary_error as string | null, markdown: String(row.markdown),
    };
}

export function validateReportFilter(filter: ReportFilter): Required<Pick<ReportFilter, "page" | "pageSize">> & ReportFilter {
    if (filter.type !== undefined && !REPORT_TYPES.includes(filter.type)) throw new Error("报告类型无效");
    if (filter.fromDate !== undefined) validateRecordDate(filter.fromDate);
    if (filter.toDate !== undefined) validateRecordDate(filter.toDate);
    if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) throw new Error("报告开始日期不能晚于结束日期");
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error("报告分页参数无效，页大小需为 1 到 50");
    return { ...filter, page, pageSize };
}

export class ReportStore {
    constructor(readonly db: DatabaseSync, readonly now: () => number = Date.now) {
        // 不同会话使用不同连接时，等待短写事务结束后再检查最新版本。
        db.exec("PRAGMA busy_timeout = 5000");
        initializeReportSchema(db);
    }

    private transaction<T>(operation: () => T): T {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const value = operation();
            this.db.exec("COMMIT");
            return value;
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    get(id: string): SavedReport | null {
        const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
        return row ? savedReport(row) : null;
    }

    versions(report: ReportMetadata): ReportMetadata[] {
        return this.db.prepare("SELECT * FROM reports WHERE type = ? AND from_date = ? AND to_date = ? ORDER BY version DESC")
            .all(report.type, report.fromDate, report.toDate).map(metadata);
    }

    list(filter: ReportFilter = {}): ReportList {
        const { page, pageSize, ...query } = validateReportFilter(filter);
        const clauses: string[] = [];
        const values: string[] = [];
        if (query.type) { clauses.push("type = ?"); values.push(query.type); }
        if (query.fromDate) { clauses.push("to_date >= ?"); values.push(query.fromDate); }
        if (query.toDate) { clauses.push("from_date <= ?"); values.push(query.toDate); }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const total = Number(this.db.prepare(`SELECT count(*) AS count FROM reports ${where}`).get(...values)!.count);
        const reports = this.db.prepare(`SELECT id, type, from_date, to_date, cutoff_date, ongoing, version, created_at, summary_status, model, schema_version, template_version
            FROM reports ${where} ORDER BY created_at DESC, version DESC, id LIMIT ? OFFSET ?`)
            .all(...values, pageSize, (page - 1) * pageSize).map(metadata);
        return { reports, total, page, pageSize };
    }

    /** 原子复用/新建版本并领取短租约；网络请求在事务外执行。 */
    reserve(snapshot: ReportSnapshot, statistics: ReportStatistics, sourceFingerprint: string, regenerate: boolean): { report: SavedReport; token: string | null } {
        return this.transaction(() => {
            const period = snapshot.period;
            const row = this.db.prepare("SELECT * FROM reports WHERE type = ? AND from_date = ? AND to_date = ? ORDER BY version DESC LIMIT 1")
                .get(period.type, period.fromDate, period.toDate);
            let report = row ? savedReport(row) : null;
            if (report && !regenerate) return { report, token: null };
            if (report?.sourceFingerprint === sourceFingerprint) {
                if (report.summaryStatus === "complete" || report.summaryStatus === "not_applicable" || Number(row!.lease_expires_at) > this.now()) {
                    return { report, token: null };
                }
            } else {
                report = {
                    id: randomUUID(), type: period.type, fromDate: period.fromDate, toDate: period.toDate,
                    cutoffDate: period.cutoffDate, ongoing: period.ongoing, version: (report?.version ?? 0) + 1,
                    createdAt: new Date(this.now()).toISOString(), sourceFingerprint, snapshot, statistics, summary: null, summaryError: null,
                    summaryStatus: statistics.totals.foodDays || statistics.totals.exerciseDays ? "pending" : "not_applicable",
                    model: null, schemaVersion: 1, templateVersion: 1, markdown: "",
                };
                report.markdown = renderReportMarkdown(report);
                this.db.prepare(`INSERT INTO reports (id, type, from_date, to_date, cutoff_date, ongoing, version, created_at,
                    source_fingerprint, snapshot_json, statistics_json, summary_status, schema_version, template_version, markdown)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                    .run(report.id, report.type, report.fromDate, report.toDate, report.cutoffDate, Number(report.ongoing), report.version, report.createdAt,
                        sourceFingerprint, JSON.stringify(snapshot), JSON.stringify(statistics), report.summaryStatus, 1, 1, report.markdown);
            }
            if (report.summaryStatus === "not_applicable") return { report, token: null };
            const token = randomUUID();
            report.summaryStatus = "pending";
            report.summaryError = null;
            report.markdown = renderReportMarkdown(report);
            this.db.prepare("UPDATE reports SET lease_token = ?, lease_expires_at = ?, summary_status = 'pending', summary_error = NULL, markdown = ? WHERE id = ?")
                .run(token, this.now() + 60_000, report.markdown, report.id);
            return { report, token };
        });
    }

    finish(id: string, token: string, summary: ReportSummary | null, model: string | null, error: string | null): void {
        this.transaction(() => {
            const row = this.db.prepare("SELECT * FROM reports WHERE id = ? AND lease_token = ? AND summary_status = 'pending'").get(id, token);
            if (!row) return;
            const report = savedReport(row);
            report.summary = summary;
            report.model = model;
            report.summaryStatus = summary ? "complete" : "failed";
            report.summaryError = error;
            report.markdown = renderReportMarkdown(report);
            this.db.prepare("UPDATE reports SET summary_json = ?, summary_status = ?, summary_error = ?, model = ?, markdown = ?, lease_token = NULL, lease_expires_at = NULL WHERE id = ? AND lease_token = ?")
                .run(summary ? JSON.stringify(summary) : null, report.summaryStatus, error, model, report.markdown, id, token);
        });
    }
}
