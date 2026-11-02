import { ChromaClient, type Metadata } from "chromadb";

import type { KnowledgeChunk, KnowledgeSearchResult, KnowledgeVectorStore } from "./types.ts";

// 首版只有一个减脂知识集合；不同业务知识库应使用不同 collection，避免跨领域召回。
const COLLECTION_NAME = "fatloss_knowledge";

function createClient(): ChromaClient {
  // Chroma CLI 默认监听 localhost；这里不使用 127.0.0.1 以兼容本机 IPv6 回环监听。
  const port = Number(process.env.CHROMA_PORT ?? "8000");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("CHROMA_PORT 必须是有效端口号。");
  return new ChromaClient({ host: process.env.CHROMA_HOST?.trim() || "localhost", port });
}

function toMetadata(chunk: KnowledgeChunk): Metadata {
  // document 存完整可读文本；metadata 则提供题号、来源等可筛选/展示的结构化字段。
  return {
    sourceId: chunk.sourceId,
    sourceFile: chunk.sourceFile,
    questionNumber: chunk.questionNumber,
    question: chunk.question,
    chunkIndex: chunk.chunkIndex,
    contentHash: chunk.contentHash,
  };
}

function getString(metadata: Metadata | null, key: string): string {
  // Chroma 元数据来自外部存储，读取时保持防御性，避免单条脏记录让整次检索失败。
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function getNumber(metadata: Metadata | null, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" ? value : 0;
}

/** Chroma 仅保存预计算向量，所有嵌入调用都留在应用进程中。 */
export class ChromaKnowledgeStore implements KnowledgeVectorStore {
  // client 允许注入，以便测试替换为内存 mock，业务代码默认连接本机 Chroma。
  constructor(private readonly client: Pick<ChromaClient, "getOrCreateCollection" | "getCollection"> = createClient()) {}

  async replaceSource(sourceId: string, chunks: KnowledgeChunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) throw new Error("没有可写入的知识块。");
    if (chunks.length !== embeddings.length) throw new Error("知识块与向量数量不一致。");
    // embeddingFunction: null 表示我们传入的是应用侧预计算向量，Chroma 不下载模型也不持有 API Key。
    const collection = await this.client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: null,
      metadata: { description: "减脂问答知识库，向量由百炼 qwen3.7-text-embedding-flash 生成。" },
    });
    // KnowledgeService 已先成功生成所有向量；此时才删旧块并写入新块，降低更新失败造成空库的风险。
    await collection.delete({ where: { sourceId } });
    await collection.upsert({
      ids: chunks.map((chunk) => chunk.id),
      documents: chunks.map((chunk) => chunk.document),
      metadatas: chunks.map(toMetadata),
      embeddings,
    });
  }

  async search(queryEmbedding: number[], limit: number): Promise<KnowledgeSearchResult[]> {
    let collection;
    try {
      collection = await this.client.getCollection({ name: COLLECTION_NAME });
    } catch (error) {
      throw new Error("知识库尚未建立，请先运行 npm run kb:index。", { cause: error });
    }
    // 直接用查询向量检索，确保查询与入库始终使用同一套百炼模型和维度。
    const result = await collection.query({ queryEmbeddings: [queryEmbedding], nResults: limit, include: ["documents", "metadatas", "distances"] });
    return (result.ids[0] ?? []).flatMap((id, index) => {
      const document = result.documents[0]?.[index];
      const metadata = result.metadatas[0]?.[index] ?? null;
      if (!id || !document) return [];
      return [{
        id,
        sourceId: getString(metadata, "sourceId"),
        sourceFile: getString(metadata, "sourceFile"),
        questionNumber: getNumber(metadata, "questionNumber"),
        question: getString(metadata, "question"),
        chunkIndex: getNumber(metadata, "chunkIndex"),
        document,
        contentHash: getString(metadata, "contentHash"),
        distance: result.distances[0]?.[index] ?? null,
      }];
    });
  }
}
