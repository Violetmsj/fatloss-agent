import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { ProfileInput } from "../core/profile.ts";

import type { PluginStatus } from "../types.ts";


/** 公开的是有限业务方法；文件系统路径与模型凭据留在宿主。 */
export class FatlossController extends TypertRemoteService {
    constructor(ctx: Context) { super(ctx, "fatlossController", { namespace: "fatloss" }); }

    /** @returns 当前插件状态，不含文件路径和凭据。 */
    @Remote("status")
    status(): PluginStatus { return this.ctx.fatloss.status(); }

    /** @returns 当前单用户画像，未建档时为 null。 */
    @Remote("getProfile")
    getProfile(): string { return JSON.stringify(this.ctx.fatloss.repository.get()); }

    /** @param input 待校验画像。 @returns 仅预览，不写入数据库。 */
    @Remote("previewProfile")
    previewProfile(input: string): string { return JSON.stringify(this.ctx.fatloss.preview(JSON.parse(input) as ProfileInput)); }

    /** @param input 用户确认后的完整画像。 @returns 已保存画像。 */
    @Remote("saveProfile")
    saveProfile(input: string): string { return JSON.stringify(this.ctx.fatloss.save(JSON.parse(input) as ProfileInput)); }

    /** @param filter 报告周期与分页。 @returns 已保存报告列表的 JSON 文本。 */
    @Remote("listReports")
    listReports(filter: string): string { return JSON.stringify(this.ctx.fatloss.listReports(JSON.parse(filter))); }

    /** @param id 列表给出的报告 ID。 @returns 含历史版本和过期状态的报告 JSON。 */
    @Remote("getReport")
    getReport(id: string): string { return JSON.stringify(this.ctx.fatloss.report(id)); }

    /** @param id 列表给出的报告 ID。 @returns 已保存 Markdown，不重新生成。 */
    @Remote("exportReport")
    exportReport(id: string): string { return this.ctx.fatloss.report(id).markdown; }

    /** @param signal 页面生命周期。 @returns 初始状态及业务写入后的刷新信号。 */
    @Remote({ mode: "stream" })
    async *changes(signal: AbortSignal): AsyncIterable<number> {
        let revision = 0;
        let wake: (() => void) | undefined;
        const unsubscribe = this.ctx.fatloss.subscribe(() => { revision++; wake?.(); });
        const onAbort = () => wake?.();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            while (!signal.aborted) {
                const seen = revision;
                yield seen;
                if (revision === seen) await new Promise<void>(resolve => { wake = resolve; if (signal.aborted || revision !== seen) resolve(); });
            }
        } finally { unsubscribe(); signal.removeEventListener("abort", onAbort); }
    }
}

declare module "@deepseek-ai/cordis" {
    interface Context { fatlossController: FatlossController; }
}
