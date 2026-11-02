import { defineTool, type FatlossToolContext } from "./definition.ts";
import { Type } from "typebox";

import type { ProfileRepository } from "../database.ts";
import { REPORT_SUMMARY_PROMPT, ReportService } from "../reports/service.ts";
import { REPORT_TITLES, REPORT_TYPES, type ReportRequest, type ReportView } from "../reports/types.ts";

function reportResult(report: ReportView, context?: FatlossToolContext) {
    if (!context?.reportUrl) throw new Error("当前会话未配置 DSH 报告导航。");
    const details = {
        reportId: report.id, reportUrl: context.reportUrl(report.id), title: REPORT_TITLES[report.type],
        version: report.version, stale: report.stale, summaryStatus: report.summaryStatus,
    };
    return {
        content: [{ type: "text" as const, text: `${report.stale ? "此报告已过期，以下为已保存快照。只有用户明确要求更新时才传 regenerate: true。\n\n" : ""}${report.markdown}\n查看报告：[${details.title}](${details.reportUrl})` }],
        details,
    };
}

export function createReportTools(repository: ProfileRepository, service = new ReportService(repository.db)) {
    const generate = async (request: ReportRequest, signal: AbortSignal | undefined, ctx: FatlossToolContext) => reportResult(await service.generate(request, {
        model: ctx.modelName ?? null,
        generate: async (input, abortSignal) => {
            if (!ctx.generateText) throw new Error("当前会话没有可用于生成报告总结的模型");
            return ctx.generateText(REPORT_SUMMARY_PROMPT, input, abortSignal);
        },
    }, signal), ctx);
    const regenerate = Type.Optional(Type.Boolean({ description: "仅在用户明确要求更新已存报告或重试失败总结时传 true；默认直接读取。" }));
    const description = "读取或生成固定模板报告并保存统计快照和 AI 总结。已有报告默认复用；用户明确更新或重试时 regenerate=true。相对日期先单独调用 get_current_time。";
    return [
        defineTool({
            name: "generate_daily_report", label: "生成减脂日报", description,
            parameters: Type.Object({ date: Type.String({ description: "YYYY-MM-DD" }), regenerate }, { additionalProperties: false }),
            async execute(_id, args, signal, _update, ctx) { return generate({ type: "daily", ...args }, signal, ctx); },
        }),
        defineTool({
            name: "generate_weekly_report", label: "生成减脂周报", description: `${description} 日期所在自然周为周一至周日。`,
            parameters: Type.Object({ date: Type.String({ description: "周内任一日期 YYYY-MM-DD" }), regenerate }, { additionalProperties: false }),
            async execute(_id, args, signal, _update, ctx) { return generate({ type: "weekly", ...args }, signal, ctx); },
        }),
        defineTool({
            name: "generate_monthly_report", label: "生成减脂月报", description,
            parameters: Type.Object({ month: Type.String({ description: "YYYY-MM" }), regenerate }, { additionalProperties: false }),
            async execute(_id, args, signal, _update, ctx) { return generate({ type: "monthly", ...args }, signal, ctx); },
        }),
        defineTool({
            name: "generate_yearly_report", label: "生成减脂年报", description,
            parameters: Type.Object({ year: Type.Integer({ minimum: 1, maximum: 9999 }), regenerate }, { additionalProperties: false }),
            async execute(_id, args, signal, _update, ctx) { return generate({ type: "yearly", ...args }, signal, ctx); },
        }),
        defineTool({
            name: "generate_custom_report", label: "生成自定义减脂报告", description,
            parameters: Type.Object({ fromDate: Type.String(), toDate: Type.String(), regenerate }, { additionalProperties: false }),
            async execute(_id, args, signal, _update, ctx) { return generate({ type: "custom", ...args }, signal, ctx); },
        }),
        defineTool({
            name: "list_reports", label: "查询减脂报告", description: "分页查询已保存的减脂报告及版本。日期筛选匹配与查询区间有交集的报告。不会调用模型或重新生成。",
            parameters: Type.Object({
                type: Type.Optional(Type.Union(REPORT_TYPES.map((type) => Type.Literal(type)))),
                fromDate: Type.Optional(Type.String()), toDate: Type.Optional(Type.String()),
                page: Type.Optional(Type.Integer({ minimum: 1 })), pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
            }, { additionalProperties: false }),
            async execute(_id, args) {
                const list = service.store.list(args);
                return { content: [{ type: "text" as const, text: JSON.stringify(list) }], details: list };
            },
        }),
        defineTool({
            name: "get_report", label: "读取减脂报告", description: "按 list_reports 返回的报告 ID 读取指定历史版本、Markdown 文本和过期状态。不重新计算已存指标，不调用模型。",
            parameters: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
            async execute(_id, { id }, _signal, _update, ctx) {
                const report = service.get(id);
                if (!report) throw new Error("报告不存在，请先查询已保存报告");
                return reportResult(report, ctx);
            },
        }),
    ];
}
