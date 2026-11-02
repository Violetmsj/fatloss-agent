// 隔离 profile 的压缩验收：只使用本机假模型，不打入安装包。
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { appendFileSync } from "node:fs";

export const name = "fatloss-compaction-fixture";
export const inject = ["llm", "agentPresets", "tokenMeter"];

export function apply(ctx) {
    const record = event => appendFileSync(process.env.FATLOSS_COMPACTION_RECEIPT, JSON.stringify(event) + "\n");
    ctx.on("agent/created", ({ agent }) => {
        if (ctx.agentPresets.composedPreset(agent.ctx) !== "fatloss") return;
        const basic = ctx.agentPresets.serviceFor(agent, "compaction");
        record({ kind: "backend", sessionId: agent.session.id, basic: !!basic, auto: basic?.config.auto });
        if (!!basic === (process.env.FATLOSS_EXPECT_BILLION === "1")) throw new Error("减脂预设压缩后端选择错误");
        agent.ctx.on("agent/pre-step", (_event, next) => {
            record({ kind: "pressure", sessionId: agent.session.id, tokens: ctx.tokenMeter.measure(agent.session).totalTokens });
            return next();
        });
    });
    class FixtureAdapter extends LlmAdapter {
        async listModels(provider) { return [{ provider, id: "fixture", name: "官方压缩隔离验收模型", inputModalities: ["text"], context: { contextWindow: 200000 }, defaultMaxTokens: 4096 }]; }
        async resolveModel(provider, model) { return { ...(await this.listModels(provider))[0], id: model }; }
        async *stream(options) {
            options.signal?.throwIfAborted();
            const last = options.messages.at(-1)?.content.filter(block => block.type === "text").map(block => block.text).join("\n") || "";
            const summary = last.includes("You are now acting as a compaction engine");
            if (summary) record({ kind: "summary", sessionId: options.sessionId, provider: options.provider, model: options.model });
            const text = summary ? "虚拟历史摘要：此前只有上下文压缩验收资料，没有真实画像和饮食运动写入。继续完成压缩验收。" : options.system ? "[]" : "虚拟验收资料已收到。";
            yield { type: "block-start", index: 0, blockType: "text" };
            yield { type: "text-delta", index: 0, text };
            yield { type: "block-end", index: 0, block: { type: "text", text } };
            yield { type: "finish", reason: { kind: "stop" } };
        }
    }
    ctx.llm.registerAdapter(["compaction-fixture"], new FixtureAdapter());
}
