import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { MemoryStore } from "./memory-store.ts";
import { MEMORY_EXTRACTION_PROMPT, parseMemoryCandidates, type MemoryCategory, type MemoryMessage } from "./memory.ts";

interface EvaluationCase {
    name: string;
    existing?: { content: string; category: MemoryCategory; quote: string };
    messages: { role: "user" | "assistant"; text: string }[];
    expectedActions: string[];
    review: string;
}

// 手动执行才请求真实模型；只使用内存 SQLite，不读取或修改个人画像及记忆。
const [provider = "deepseek", modelId = "deepseek-flash"] = process.argv.slice(2);
// 关闭的是模型目录刷新联网；后面的 complete 仍会请求真实模型，不能当成离线测试运行。
const runtime = await ModelRuntime.create({ allowModelNetwork: false });
const model = runtime.getModel(provider, modelId);
if (!model) throw new Error(`未找到模型 ${provider}/${modelId}，请使用已配置的 pi 模型。`);
const cases: EvaluationCase[] = JSON.parse(await readFile(new URL("../test/fixtures/memory-evaluation.json", import.meta.url), "utf8"));
const now = Date.parse("2026-09-18T12:00:00+08:00");
let failures = 0;
for (const [index, sample] of cases.entries()) {
    const db = new DatabaseSync(":memory:"); // 每个样例独立建库，避免前一案例影响后一案例。
    try {
        const store = new MemoryStore(db, () => now);
        const messages: MemoryMessage[] = sample.messages.map((message, i) => ({
            ...message, id: `m${i}`, key: `case-${index}-${i}`, sessionId: "evaluation",
            timestamp: new Date(now + i * 1000).toISOString(),
        }));
        if (sample.existing) {
            const source: MemoryMessage = { id: "seed", key: "seed", sessionId: "evaluation", role: "user", text: sample.existing.quote, timestamp: new Date(now - 86400000).toISOString() };
            store.apply([{ action: "create", content: sample.existing.content, category: sample.existing.category, evidence: [{ messageId: source.id, quote: source.text }] }], [source], store.revision);
        }
        const pending = messages.filter((message) => message.role === "user");
        const input = {
            timezone: "Asia/Shanghai", pendingMessageIds: pending.map((message) => message.id), context: messages,
            profile: { weightKg: 80, targetBodyFatPct: 20 }, existingMemories: store.all(), forgottenSourceKeys: [],
        };
        const response = await runtime.complete(model, {
            systemPrompt: MEMORY_EXTRACTION_PROMPT,
            messages: [{ role: "user", content: JSON.stringify(input), timestamp: now }],
        }, { signal: AbortSignal.timeout(60000) });
        if (response.stopReason === "error" || response.stopReason === "aborted" || response.stopReason === "length") throw new Error("模型没有完整返回结果。");
        const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        const candidates = parseMemoryCandidates(JSON.parse(text));
        store.apply(candidates, pending, store.revision, pending);
        // 这里只能自动核对动作种类/数量；“同为 create 但内容理解错了”仍需按 review 人工检查。
        const matches = JSON.stringify(candidates.map((candidate) => candidate.action).sort()) === JSON.stringify([...sample.expectedActions].sort());
        if (!matches) failures++;
        console.log(JSON.stringify({ name: sample.name, actionCheck: matches ? "通过" : "需检查", expectedActions: sample.expectedActions, candidates, saved: store.list({ status: "all" }).items, review: sample.review }, null, 2));
    } catch (error) {
        failures++;
        console.error(`${sample.name}：${error instanceof Error ? error.message : "评估失败"}`);
    } finally {
        db.close();
    }
}
console.log(`共 ${cases.length} 个样例，动作或校验异常 ${failures} 个。动作相符不代表语义正确，请按 review 人工核对。`);
if (failures) process.exitCode = 1;
