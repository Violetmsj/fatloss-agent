import type { DatabaseSync } from "node:sqlite";

import { DailyRecordStore } from "../daily-record-store.ts";
import { calculateReportStatistics, fingerprint, readReportSnapshot, resolveReportPeriod, shanghaiDate } from "./statistics.ts";
import { ReportStore } from "./store.ts";
import type { ReportRequest, ReportSummary, ReportView, SavedReport } from "./types.ts";

export const REPORT_SUMMARY_PROMPT = `你是中文减脂记录报告的总结助手。只使用输入的程序统计，不执行计算，不补造数值，不将已记录摄入当作完整摄入。
未记录不等于零；日均摄入仅以饮食记录日为分母；营养素可能仅有已知部分；历史能量参考可能缺失；运动消耗不叠加至 TDEE。
不得判定达标率、推算实际能量缺口或预测减重，不做医学诊断、不承诺减重结果。记录覆盖稀疏时明确说明局限。
只返回 JSON 对象，恰好包含 overview（中文概述字符串）、observations（中文观察字符串数组）、limitations（中文数据局限字符串数组）、nextSteps（中文下一阶段建议字符串数组）。
overview 不超过 600 字，每个数组最多 5 项，每项不超过 300 字。建议以改善记录和可持续习惯为主，不制定临床治疗或激进饮食方案。`;

export interface SummaryGenerator {
    model: string | null;
    generate: (input: string, signal: AbortSignal) => Promise<string>;
}

export function parseReportSummary(text: string): ReportSummary {
    const value: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("总结格式无效");
    const object = value as Record<string, unknown>;
    const keys = ["overview", "observations", "limitations", "nextSteps"];
    if (Object.keys(object).length !== 4 || keys.some((key) => !(key in object))) throw new Error("总结字段无效");
    if (typeof object.overview !== "string" || !object.overview.trim() || object.overview.length > 600) throw new Error("总结概述无效");
    for (const key of keys.slice(1)) {
        const lines = object[key];
        if (!Array.isArray(lines) || lines.length > 5 || lines.some((line) => typeof line !== "string" || !line.trim() || line.length > 300)) throw new Error("总结条目无效");
    }
    return object as unknown as ReportSummary;
}

export class ReportService {
    readonly store: ReportStore;
    private readonly records: DailyRecordStore;

    constructor(readonly db: DatabaseSync, readonly now: () => number = Date.now, readonly summaryTimeoutMs = 45_000) {
        this.store = new ReportStore(db, now);
        this.records = new DailyRecordStore(db, now);
    }

    private currentSnapshot(report: Pick<SavedReport, "type" | "fromDate" | "toDate">) {
        const today = shanghaiDate(this.now());
        const cutoffDate = report.toDate < today ? report.toDate : today;
        const period = resolveReportPeriod({ type: "custom", fromDate: report.fromDate, toDate: report.toDate }, today);
        return readReportSnapshot(this.db, this.records, { ...period, type: report.type, cutoffDate });
    }

    get(id: string): ReportView | null {
        const report = this.store.get(id);
        if (!report) return null;
        return { ...report, stale: fingerprint(this.currentSnapshot(report)) !== report.sourceFingerprint, versions: this.store.versions(report) };
    }

    async generate(request: ReportRequest, generator: SummaryGenerator, signal?: AbortSignal): Promise<ReportView> {
        const period = resolveReportPeriod(request, shanghaiDate(this.now()));
        const snapshot = readReportSnapshot(this.db, this.records, period);
        const statistics = calculateReportStatistics(snapshot);
        const { report, token } = this.store.reserve(snapshot, statistics, fingerprint(snapshot), request.regenerate === true);
        if (token) {
            const timeout = AbortSignal.timeout(this.summaryTimeoutMs);
            const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
            let onAbort: (() => void) | undefined;
            try {
                combined.throwIfAborted();
                // 年报只传月度汇总；不把整年的原始食物明细塞入模型上下文。
                const input = JSON.stringify({
                    period: report.snapshot.period, totals: report.statistics.totals, groups: report.statistics.groups,
                    meals: report.statistics.meals, nutrition: report.statistics.nutrition, exercises: report.statistics.exercises,
                });
                const aborted = new Promise<never>((_resolve, reject) => {
                    onAbort = () => reject(combined.reason);
                    combined.addEventListener("abort", onAbort, { once: true });
                });
                const text = await Promise.race([generator.generate(input, combined), aborted]);
                combined.throwIfAborted();
                this.store.finish(report.id, token, parseReportSummary(text), generator.model, null);
            } catch {
                const error = signal?.aborted ? "总结已取消，统计已保存。" : timeout.aborted ? "总结超时，统计已保存。" : "AI 总结失败，统计已保存，可通过聊天重试。";
                this.store.finish(report.id, token, null, generator.model, error);
            } finally {
                if (onAbort) combined.removeEventListener("abort", onAbort);
            }
        }
        return this.get(report.id)!;
    }
}
