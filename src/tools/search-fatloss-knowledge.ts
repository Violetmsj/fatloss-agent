import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { type KnowledgeService, createKnowledgeService } from "../knowledge/service.ts";

function formatResults(results: Awaited<ReturnType<KnowledgeService["search"]>>): string {
  if (results.length === 0) return "知识库中没有找到足够相关的内容。请说明当前无法依据知识库给出结论。";
  return results
    .map((result) => `【参考知识库：${result.questionNumber}. ${result.question}】\n${result.document}`)
    .join("\n\n---\n\n");
}

/** 模型只能检索预先建立的减脂知识库，不能读取工作区中的原始文件。 */
export function createSearchFatlossKnowledgeTool(knowledgeService: KnowledgeService = createKnowledgeService()) {
  return defineTool({
    name: "search_fatloss_knowledge",
    label: "检索减脂知识库",
    description: "根据用户的减脂问题检索本地问答知识库。回答知识库涵盖的话题前必须调用，并使用返回的题目标题标明来源。",
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 500, description: "用户需要解答的减脂问题" }),
    }),
    async execute(_toolCallId, params) {
      const results = await knowledgeService.search(params.question, 3);
      return {
        content: [{ type: "text" as const, text: formatResults(results) }],
        details: results,
      };
    },
  });
}
