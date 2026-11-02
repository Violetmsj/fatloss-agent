import type { Context } from "@deepseek-ai/cordis";

// Billion Context 的上下文工具；不按 acp_* 前缀放行委派或其他能力。
export const BILLION_CONTEXT_TOOLS = [
    "compress", "decompress", "search_context", "acp_status", "acp_cache", "acp_retrieve", "acp_read_original_image",
] as const;

export function registerFatlossToolPolicy(local: Context, host: Context, businessNames: string[]): () => void {
    let current = "";
    let release: (() => void) | undefined;
    const refresh = () => {
        const allow = [...businessNames, ...BILLION_CONTEXT_TOOLS.filter(name => host.tools.get(name))];
        const signature = JSON.stringify(allow);
        if (signature === current) return;
        // 两个限制会相交：先装新限制，再移除旧限制，更新期间也不放开其他工具。
        const previous = release;
        release = local.tools.restrict({ allow });
        current = signature;
        previous?.();
    };
    refresh();
    // 代理启动后的工具注册可能晚于会话创建；请求装配前再检查一次。
    const removeListener = local.on("agent/pre-step", (_event, next) => { refresh(); return next(); });
    return () => { removeListener(); release?.(); };
}
