import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-app-boot";

declare module "@deepseek-ai/cordis" {
    interface Context { fatlossCompactionReady: boolean; }
}

/** 等待 Billion 的加载期协调器，再让它决定是否停用预设内的 Basic。 */
export function registerFatlossCompactionReady(ctx: Context): void {
    if (ctx.profileContext.startedBundles.includes("billion-context")) {
        ctx.inject(["biliBasicCompactionPolicy"], ready => { ready.provide("fatlossCompactionReady", true); });
    } else {
        ctx.provide("fatlossCompactionReady", true);
    }
}
