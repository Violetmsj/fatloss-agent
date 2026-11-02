import { readFile } from "node:fs/promises";

import { FATLOSS_KNOWLEDGE_SOURCE_ID, parseFatlossKnowledgeMarkdown } from "../src/core/knowledge/markdown.ts";
import { createKnowledgeService } from "../src/core/knowledge/service.ts";

async function main(): Promise<void> {
  // 索引只由维护命令更新，聊天过程不会修改知识库。
  const sourcePath = new URL("../knowledge_doc/减脂-问答汇总.md", import.meta.url);
  const markdown = await readFile(sourcePath, "utf8");
  const chunks = parseFatlossKnowledgeMarkdown(markdown);
  await createKnowledgeService().index(FATLOSS_KNOWLEDGE_SOURCE_ID, chunks);
  console.log(`知识库索引完成：${chunks.length} 个片段已写入 Chroma。`);
}

main().catch((error: unknown) => {
  // 以非零退出码结束，让命令行和未来的 CI 都能感知索引失败。
  console.error(error instanceof Error ? `知识库索引失败：${error.message}` : "知识库索引失败。");
  process.exitCode = 1;
});
