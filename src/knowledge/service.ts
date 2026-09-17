import { ChromaKnowledgeStore } from "./chroma.ts";
import { DashScopeEmbeddingClient } from "./embeddings.ts";
import type { EmbeddingClient, KnowledgeChunk, KnowledgeSearchResult, KnowledgeVectorStore } from "./types.ts";

/**
 * 编排层：负责“嵌入服务 + 向量库”的先后顺序，不掺杂 Chroma SDK 或百炼 HTTP 细节。
 * 这也是索引命令与 pi 检索工具共用同一业务入口的位置。
 */
export class KnowledgeService {
  constructor(
    private readonly embeddings: EmbeddingClient,
    private readonly store: KnowledgeVectorStore,
  ) {}

  /** 先生成全部向量，再替换旧来源，避免 API 中途失败时清空已有知识库。 */
  async index(sourceId: string, chunks: KnowledgeChunk[]): Promise<void> {
    const embeddings = await this.embeddings.embedDocuments(chunks.map((chunk) => chunk.document));
    await this.store.replaceSource(sourceId, chunks, embeddings);
  }

  async search(question: string, limit = 3): Promise<KnowledgeSearchResult[]> {
    // 先把自然语言问题变成向量，再让数据库执行近邻搜索。
    const embedding = await this.embeddings.embedQuery(question);
    return this.store.search(embedding, limit);
  }
}

export function createKnowledgeService(): KnowledgeService {
  // 生产组装点；测试则直接 new KnowledgeService(fakeEmbeddings, fakeStore)。
  return new KnowledgeService(new DashScopeEmbeddingClient(), new ChromaKnowledgeStore());
}
