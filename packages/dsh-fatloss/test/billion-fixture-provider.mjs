// 仅供隔离 DSH + 真实 Billion Context 验收，模型端点在本机，不访问真实模型。
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

export const name = "fatloss-billion-fixture";
export const inject = ["llm"];

export function apply(ctx) {
    let round = 0;
    const textOf = message => typeof message.content === "string" ? message.content : (message.content || []).filter(block => block.type === "text").map(block => block.text).join("\n");
    const server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        writeFileSync("/tmp/fatloss-billion-test/last-wire.json", JSON.stringify(input));
        const verifying = input.messages.some(message => textOf(message).includes("BILLION-COMPRESS-VERIFY"));
        let message = { role: "assistant", content: "测试资料已收到。" };
        if (verifying) {
            const tools = input.tools?.map(tool => tool.function.name) || [];
            if (!["compress", "acp_status"].every(name => tools.includes(name))) throw new Error("压缩工具未传给模型");
            if (round < 3) {
                const ids = [...new Set(input.messages.filter(message => message.role === "user").flatMap(message => textOf(message).match(/m\d{5,}/g) || []))];
                const summary = "这是隔离验收的历史摘要：早期对话全部为人工构造的编号资料，不包含真实用户信息；保留它们仅用于核实 Billion Context 能通过减脂预设压缩并在后续请求复用摘要。";
                const args = round === 1 ? { content: `${ids[0]}–${ids[3]} 早期测试资料\n${summary}` } : {};
                message = { role: "assistant", content: null, tool_calls: [{ id: `billion-acceptance-${round}`, type: "function", function: { name: round === 1 ? "compress" : "acp_status", arguments: JSON.stringify(args) } }] };
            } else message = { role: "assistant", content: "Billion Context 压缩验收完成。" };
            round++;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "local-fixture", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: input.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10000, completion_tokens: 100, total_tokens: 10100 } }));
    });
    server.listen(18988, "127.0.0.1");
    ctx.effect(() => () => new Promise(resolve => server.close(resolve)));

    class FixtureAdapter extends LlmAdapter {
        async listModels(provider) { return [{ provider, id: "fixture", name: "Billion Context 本地验收模型", inputModalities: ["text"], context: { contextWindow: 200000 }, defaultMaxTokens: 4096 }]; }
        async *stream(options) {
            let message;
            if (options.system) message = { content: "[]" };
            else {
                const messages = options.messages.map(item => {
                    if (item.role === "tool") return { role: "tool", tool_call_id: item.toolCallId, content: textOf(item) };
                    const calls = item.content.filter(block => block.type === "tool-call").map(block => ({ id: block.id, type: "function", function: { name: block.name, arguments: block.arguments } }));
                    return { role: item.role, content: textOf(item) || null, ...(calls.length ? { tool_calls: calls } : {}) };
                });
                const result = await fetch("http://127.0.0.1:18988/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "fixture", messages, stream: false, max_tokens: 4096, tools: options.tools?.map(tool => ({ type: "function", function: tool })) }), signal: options.signal });
                const output = await result.json();
                if (!result.ok || !output.choices?.[0]) throw new Error(`本地模型请求失败 ${result.status}: ${JSON.stringify(output).slice(0,500)}`);
                message = output.choices[0].message;
            }
            let index = 0;
            if (message.content) {
                yield { type: "block-start", index, blockType: "text" };
                yield { type: "text-delta", index, text: message.content };
                yield { type: "block-end", index, block: { type: "text", text: message.content } };
                index++;
            }
            for (const call of message.tool_calls || []) {
                const block = { type: "tool-call", id: call.id, name: call.function.name, arguments: call.function.arguments };
                yield { type: "block-start", index, blockType: "tool-call" };
                yield { type: "tool-call-delta", index, id: block.id, name: block.name, argumentsDelta: block.arguments };
                yield { type: "block-end", index, block }; index++;
            }
            yield { type: "finish", reason: { kind: message.tool_calls?.length ? "tool-calls" : "stop" } };
        }
    }
    ctx.llm.registerAdapter(["billion-fixture"], new FixtureAdapter());
}
