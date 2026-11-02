import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-user-approval";

const WRITE_TOOLS = new Map([
    ["update_current_profile", "更新减脂画像"],
    ["add_food_entry", "新增饮食记录"],
    ["update_food_entry", "修改饮食记录"],
    ["delete_food_entry", "删除饮食记录"],
    ["add_exercise_entry", "新增运动记录"],
    ["update_exercise_entry", "修改运动记录"],
    ["delete_exercise_entry", "删除运动记录"],
    ["delete_daily_record", "删除整日记录"],
]);

/** 模型提供的 confirmed 字段或来源标签不能代替用户对本次工具调用的审批。 */
export function registerFatlossWriteConfirmation(ctx: Context, wasCancelled: (agent: Agent) => boolean = () => false, lifetime?: AbortSignal): void {
    ctx.on("tools/pre-execute", async (exec, next) => {
        const label = WRITE_TOOLS.get(exec.name);
        if (!label) return next();
        if (!exec.agent) return { kind: "deny", reason: "减脂数据写入需要由当前用户确认。" };
        if (wasCancelled(exec.agent)) return { kind: "deny", reason: "用户已取消本次操作，请等待新的用户输入。" };
        const signal = lifetime ? AbortSignal.any([exec.signal, lifetime]) : exec.signal;
        if (signal.aborted) return { kind: "cancel" };
        const approval = ctx.get("approval");
        if (!approval) return { kind: "deny", reason: "用户审批服务不可用，减脂数据没有变更。" };
        try {
            const outcome = await approval.request({
                agent: exec.agent, toolName: exec.name, callId: exec.callId, signal,
                reason: `确认${label}`,
                displayReason: { zh: `确认${label}`, en: `Confirm ${exec.name}` },
            });
            if (signal.aborted) return { kind: "cancel" };
            if (wasCancelled(exec.agent)) return { kind: "deny", reason: "用户已取消本次操作，请等待新的用户输入。" };
            if (outcome === "allowed-once") return next();
            if (outcome === "cancelled") return { kind: "cancel" };
            return { kind: "deny", reason: outcome === "rejected" ? "用户未确认本次减脂数据写入，数据没有变更。" : "用户审批服务不可用，减脂数据没有变更。" };
        } catch {
            return signal.aborted ? { kind: "cancel" } : { kind: "deny", reason: "未能取得用户确认，减脂数据没有变更。" };
        }
    });
}
