import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { DashScopeEmbeddingClient, EMBEDDING_DIMENSIONS } from "../src/knowledge/embeddings.ts";
import { ChromaKnowledgeStore } from "../src/knowledge/chroma.ts";
import { FATLOSS_KNOWLEDGE_SOURCE_ID, parseFatlossKnowledgeMarkdown, splitAnswer } from "../src/knowledge/markdown.ts";
import { KnowledgeService } from "../src/knowledge/service.ts";
import type { EmbeddingClient, KnowledgeChunk, KnowledgeSearchResult, KnowledgeVectorStore } from "../src/knowledge/types.ts";
import { createSearchFatlossKnowledgeTool } from "../src/tools/search-fatloss-knowledge.ts";

const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

test("问答 Markdown 按 26 个标题解析，且每个片段重复原问题", async () => {
  const markdown = await readFile(resolve(process.cwd(), "knowledge_doc", "减脂-问答汇总.md"), "utf8");
  const chunks = parseFatlossKnowledgeMarkdown(markdown);

  assert.ok(chunks.length >= 26);
  assert.equal(new Set(chunks.map((chunk) => chunk.questionNumber)).size, 26);
  assert.ok(chunks.every((chunk) => chunk.document.startsWith(`问题：${chunk.question}`)));
  assert.ok(chunks.every((chunk) => chunk.contentHash.length === 64));
});

test("长段落会按语义边界拆分，短段落保持完整", () => {
  const answer = `${"第一段。".repeat(450)}\n\n第二段。`;
  const chunks = splitAnswer(answer);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
  assert.deepEqual(splitAnswer("简短答案。"), ["简短答案。"]);
});

test("百炼客户端分批请求并校验 1024 维结果", async () => {
  const originalKey = process.env.DASHSCOPE_API_KEY;
  const originalUrl = process.env.DASHSCOPE_EMBEDDING_URL;
  process.env.DASHSCOPE_API_KEY = "test-key";
  process.env.DASHSCOPE_EMBEDDING_URL = "https://embedding.example.test";
  const calls: unknown[] = [];
  const client = new DashScopeEmbeddingClient(async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    const input = JSON.parse(String(init?.body)).input as string[];
    return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: vector })) }), { status: 200 });
  });

  try {
    const embeddings = await client.embedDocuments(Array.from({ length: 21 }, (_, index) => `文本 ${index}`));
    assert.equal(embeddings.length, 21);
    assert.equal(calls.length, 2);
    assert.equal((calls[0] as { dimensions: number }).dimensions, 1024);
    assert.equal((calls[0] as { model: string }).model, "qwen3.7-text-embedding-flash");
  } finally {
    if (originalKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.DASHSCOPE_EMBEDDING_URL;
    else process.env.DASHSCOPE_EMBEDDING_URL = originalUrl;
  }
});

test("Chroma 仓储按来源替换并把查询结果还原为知识片段", async () => {
  const chunk = parseFatlossKnowledgeMarkdown("## 1.吃外卖怎么办？\n\n选择主食、瘦肉和蔬菜。")[0];
  let deletedSourceId = "";
  let upsertedIds: string[] = [];
  const collection = {
    delete: async ({ where }: { where?: { sourceId?: string } }) => {
      deletedSourceId = where?.sourceId ?? "";
    },
    upsert: async ({ ids }: { ids: string[] }) => {
      upsertedIds = ids;
    },
    query: async () => ({
      ids: [[chunk.id]],
      documents: [[chunk.document]],
      metadatas: [[{
        sourceId: chunk.sourceId,
        sourceFile: chunk.sourceFile,
        questionNumber: chunk.questionNumber,
        question: chunk.question,
        chunkIndex: chunk.chunkIndex,
        contentHash: chunk.contentHash,
      }]],
      distances: [[0.12]],
    }),
  };
  const store = new ChromaKnowledgeStore({
    getOrCreateCollection: async () => collection,
    getCollection: async () => collection,
  } as never);

  await store.replaceSource(chunk.sourceId, [chunk], [vector]);
  const results = await store.search(vector, 3);
  assert.equal(deletedSourceId, chunk.sourceId);
  assert.deepEqual(upsertedIds, [chunk.id]);
  assert.equal(results[0].question, "吃外卖怎么办？");
  assert.equal(results[0].distance, 0.12);
});

class FakeEmbeddings implements EmbeddingClient {
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(() => vector);
  }

  async embedQuery(): Promise<number[]> {
    return vector;
  }
}

class FakeStore implements KnowledgeVectorStore {
  sourceId: string | null = null;
  chunks: KnowledgeChunk[] = [];

  async replaceSource(sourceId: string, chunks: KnowledgeChunk[], _embeddings: number[][]): Promise<void> {
    this.sourceId = sourceId;
    this.chunks = chunks;
  }

  async search(_queryEmbedding: number[], limit: number): Promise<KnowledgeSearchResult[]> {
    return this.chunks.slice(0, limit).map((chunk) => ({ ...chunk, distance: 0.2 }));
  }
}

test("索引在全部向量生成后写入，并且工具最多返回三条带来源的结果", async () => {
  const chunks = parseFatlossKnowledgeMarkdown("## 1.吃外卖怎么办？\n\n选择主食、瘦肉和蔬菜。\n\n## 2.感觉饿怎么办？\n\n优先调整正餐。");
  const store = new FakeStore();
  const service = new KnowledgeService(new FakeEmbeddings(), store);
  await service.index(FATLOSS_KNOWLEDGE_SOURCE_ID, chunks);
  assert.equal(store.sourceId, FATLOSS_KNOWLEDGE_SOURCE_ID);

  const tool = createSearchFatlossKnowledgeTool(service);
  const result = await tool.execute("call-1", { question: "外卖怎么吃" }, undefined, undefined, {} as never);
  const firstContent = result.content[0];
  assert.equal(firstContent.type, "text");
  assert.match(firstContent.text, /参考知识库：1\. 吃外卖怎么办？/);
  assert.ok((result.details ?? []).length <= 3);
});
