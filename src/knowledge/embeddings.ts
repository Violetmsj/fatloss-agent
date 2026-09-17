import type { EmbeddingClient } from "./types.ts";

// 向量维度是 collection 的不可混用约束：更换模型或维度时必须重建整个知识库。
export const EMBEDDING_DIMENSIONS = 1024;
const EMBEDDING_MODEL = "qwen3.7-text-embedding-flash";
// qwen3.7-text-embedding-flash 的单次数组输入上限是 20；这里主动分批而非依赖服务端报错。
const MAX_BATCH_SIZE = 20;

type FetchFunction = typeof fetch;

function getRequiredEnvironment(name: "DASHSCOPE_API_KEY" | "DASHSCOPE_EMBEDDING_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`知识库未配置 ${name}。请按 README 设置后重试。`);
  return value;
}

function getErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return "未知服务错误";
}

function parseEmbeddings(body: unknown, expectedCount: number): number[][] {
  // 外部服务响应是未知数据，必须在写入 Chroma 前验证数量、维度和数值有效性。
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("百炼向量接口返回格式无效。");
  }
  const rows = body.data.map((item) => {
    if (!item || typeof item !== "object" || !("embedding" in item) || !Array.isArray(item.embedding)) {
      throw new Error("百炼向量接口未返回 embedding。");
    }
    const embedding: unknown[] = item.embedding;
    if (embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error(`百炼向量维度必须为 ${EMBEDDING_DIMENSIONS}，但收到 ${embedding.length}。`);
    }
    return embedding as number[];
  });
  if (rows.length !== expectedCount) throw new Error(`百炼向量数量异常：期望 ${expectedCount} 条，收到 ${rows.length} 条。`);
  return rows;
}

/** 百炼 OpenAI 兼容接口适配器；应用自行计算向量，Chroma 不持有 API Key。 */
export class DashScopeEmbeddingClient implements EmbeddingClient {
  // 可注入 fetch，单元测试无需真实 API Key 或网络请求。
  constructor(private readonly fetchFunction: FetchFunction = fetch) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const all: number[][] = [];
    for (let index = 0; index < texts.length; index += MAX_BATCH_SIZE) {
      all.push(...(await this.embedBatch(texts.slice(index, index + MAX_BATCH_SIZE))));
    }
    return all;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const apiKey = getRequiredEnvironment("DASHSCOPE_API_KEY");
    const url = getRequiredEnvironment("DASHSCOPE_EMBEDDING_URL");
    // 使用 OpenAI 兼容的 embeddings 协议；只发送文档或用户查询文本，不发送画像数据。
    const response = await this.fetchFunction(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float" }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`百炼向量请求失败（${response.status}）：${getErrorMessage(body)}`);
    return parseEmbeddings(body, texts.length);
  }
}
