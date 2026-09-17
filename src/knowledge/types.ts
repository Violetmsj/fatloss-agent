/** 单个可检索的知识片段；原问题会重复写入 document，保证切块后语义完整。 */
export interface KnowledgeChunk {
  /** Chroma 记录主键：同一题同一分块在重建索引时会被稳定覆盖。 */
  id: string;
  /** 一个 Markdown 文件的逻辑来源标识，用于只替换该来源的历史记录。 */
  sourceId: string;
  sourceFile: string;
  questionNumber: number;
  question: string;
  chunkIndex: number;
  document: string;
  contentHash: string;
}

/** 向量检索命中后补充距离；距离仅用于诊断，不交给模型作为确定性结论。 */
export interface KnowledgeSearchResult extends KnowledgeChunk {
  distance: number | null;
}

/**
 * 嵌入服务的最小边界：知识库业务不关心向量由百炼、其他云服务还是本地模型生成。
 * 未来替换模型只需实现该接口，无需改动切块、索引或 pi 工具。
 */
export interface EmbeddingClient {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/**
 * 向量数据库的最小边界。replaceSource 是“全量替换单一来源”，而不是追加，
 * 防止原 Markdown 更新后旧分块继续被检索到。
 */
export interface KnowledgeVectorStore {
  replaceSource(sourceId: string, chunks: KnowledgeChunk[], embeddings: number[][]): Promise<void>;
  search(queryEmbedding: number[], limit: number): Promise<KnowledgeSearchResult[]>;
}
