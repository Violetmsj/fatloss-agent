// 仅用于隔离 profile 的真实 DSH 循环验收，不打入发布包，也不访问模型网络。
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

export const name = "fatloss-acceptance-fixture";
export const inject = ["llm"];

export function apply(ctx) {
    const rounds = new Map();
    class FixtureAdapter extends LlmAdapter {
        async listModels(provider) { return [{ provider, id: "fixture", name: "减脂验收假模型（不联网）", inputModalities: ["text"] }]; }
        async *stream(options) {
            options.signal?.throwIfAborted();
            const text = value => [{ type: "block-start", index: 0, blockType: "text" }, { type: "text-delta", index: 0, text: value }, { type: "block-end", index: 0, block: { type: "text", text: value } }, { type: "finish", reason: { kind: "stop" } }];
            if (options.system?.includes("统计") && options.system?.includes("overview")) {
                yield* text(JSON.stringify({ overview: "这是隔离环境的验收报告。", observations: ["已保存测试饮食和运动记录。"], limitations: ["仅为功能验收，不代表真实摄入。"], nextSteps: ["继续验证历史快照和重启恢复。"] })); return;
            }
            if (options.system?.includes("记忆")) { yield* text("[]"); return; }
            const transcript = options.messages.flatMap(message => message.content || []).filter(block => block.type === "text").map(block => block.text).join("\n");
            if (transcript.includes("普通聊天验收")) {
                if (options.tools?.some(tool => tool.name === "get_current_profile")) throw new Error("普通聊天不应加载减脂工具");
                yield* text("普通聊天验收通过：未加载减脂工具。"); return;
            }
            // 会话标题等辅助请求没有业务工具，不能消耗主会话的验收步骤。
            if (!options.tools?.length) { yield* text("隔离测试会话"); return; }
            const id = options.sessionId || "default";
            const round = rounds.get(id) || 0; rounds.set(id, round + 1);
            console.info("fatloss-fixture", JSON.stringify({ id, round, question: transcript.includes("问卷验收"), roles: options.messages.map(message => message.role) }));
            const calls = [
                ["get_current_profile", {}], ["get_current_time", {}],
                ["add_food_entry", { logDate: "2026-11-01", mealType: "午餐", foodName: "验收用包装米饭", caloriesKcal: 200 }],
                ["add_exercise_entry", { logDate: "2026-11-01", exerciseName: "验收用步行", durationMinutes: 30, caloriesBurnedKcal: 100, calorieSourceType: "wearable", reportedCaloriesKcal: 100, reportedCalorieBasis: "active" }],
                ["generate_daily_report", { date: "2026-11-01" }],
            ];
            if (transcript.includes("报告周期验收")) calls.splice(0, calls.length,
                ["generate_daily_report", { date: "2026-11-01" }],
                ["generate_weekly_report", { date: "2026-11-01" }],
                ["generate_monthly_report", { month: "2026-11" }],
                ["generate_yearly_report", { year: 2026 }],
                ["generate_custom_report", { fromDate: "2026-10-30", toDate: "2026-11-01" }]);
            if (transcript.includes("问卷验收")) calls.splice(0, calls.length,
                ["ask_user", { questions: [{ id: "calories", label: "热量", prompt: "这份测试食品包装标示多少千卡？", options: [{ value: "200", label: "200 千卡" }], allowOther: true }] }],
                ["add_food_entry", { logDate: "2026-11-01", mealType: "加餐", foodName: "问卷验收食品", caloriesKcal: 200 }]);
            if (round < calls.length) {
                const [name, args] = calls[round];
                if (!options.tools?.some(tool => tool.name === name)) throw new Error(`验收工具不可见：${name}，实际工具：${options.tools?.map(tool => tool.name).join(",")}`);
                const call = { type: "tool-call", id: `acceptance-${round}`, name, arguments: JSON.stringify(args) };
                yield { type: "block-start", index: 0, blockType: "tool-call" };
                yield { type: "tool-call-delta", index: 0, id: call.id, name, argumentsDelta: call.arguments };
                yield { type: "block-end", index: 0, block: call };
                yield { type: "finish", reason: { kind: "tool-calls" } };
            } else {
                const all = options.messages.flatMap(message => message.content || []).filter(block => block.type === "text").map(block => block.text).join("\n");
                const link = all.match(/https:\/\/fatloss\.localhost\/reports\/[a-f0-9-]+/)?.[0];
                yield* text(`隔离验收完成：测试饮食、运动与日报已经保存。${link ? `\n[查看减脂日报](${link})` : ""}`);
            }
        }
    }
    ctx.llm.registerAdapter(["fatloss-fixture"], new FixtureAdapter());
}
