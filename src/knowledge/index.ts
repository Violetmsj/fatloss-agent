import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FATLOSS_KNOWLEDGE_SOURCE_ID, parseFatlossKnowledgeMarkdown } from "./markdown.ts";
import { createKnowledgeService } from "./service.ts";

async function main(): Promise<void> {
  // 索引命令只读取项目内这份固定的源文档；不从 TUI 接收文件，避免聊天过程修改知识库。
  const sourcePath = resolve(process.cwd(), "knowledge_doc", "减脂-问答汇总.md");
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
