import { createHash } from "node:crypto";

import type { KnowledgeChunk } from "./types.ts";

// sourceId 与文件名分开：文件名可变，sourceId 是 Chroma 中用于清理旧记录的稳定逻辑主键。
export const FATLOSS_KNOWLEDGE_SOURCE_ID = "fatloss-qa-summary";
export const FATLOSS_KNOWLEDGE_SOURCE_FILE = "减脂-问答汇总.md";

// 这是字符数而非 token 数；目的只是避免单个检索结果过长挤占模型上下文。
const MAX_ANSWER_CHARS = 1200;

interface QuestionSection {
  number: number;
  question: string;
  answer: string;
}

function splitOversizedParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_ANSWER_CHARS) return [paragraph];

  const parts: string[] = [];
  let remaining = paragraph;
  while (remaining.length > MAX_ANSWER_CHARS) {
    // 在长度上限附近优先寻找中文句末标点；找不到合适边界才按字符数硬切。
    const candidate = remaining.slice(0, MAX_ANSWER_CHARS + 1);
    const punctuationIndex = Math.max(
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("？"),
      candidate.lastIndexOf("；"),
      candidate.lastIndexOf("\n"),
    );
    const splitAt = punctuationIndex > MAX_ANSWER_CHARS / 2 ? punctuationIndex + 1 : MAX_ANSWER_CHARS;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

/** 优先保持段落完整；个别超长段落才按句末标点拆分。 */
export function splitAnswer(answer: string): string[] {
  const paragraphs = answer
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitOversizedParagraph);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_ANSWER_CHARS && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseSections(markdown: string): QuestionSection[] {
  // 本知识源已约定“## 序号.问题”是问答边界；不依赖正文中的换行或列表格式。
  const headingPattern = /^##\s+(\d+)\.(.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  if (matches.length === 0) throw new Error("知识库 Markdown 中没有找到“## 序号.问题”格式的问答。");

  return matches.map((match, index) => {
    // 相邻标题之间的原文就是当前题答案，因而保留了原作者的段落和列表结构。
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? markdown.length) : markdown.length;
    const answer = markdown.slice(start, end).replace(/^\s*---\s*/m, "").trim();
    if (!answer) throw new Error(`知识库第 ${match[1]} 题没有答案内容。`);
    return { number: Number(match[1]), question: match[2].trim(), answer };
  });
}

/**
 * 从现有问答 Markdown 生成稳定的 Chroma 记录。
 * ID 只依赖来源、题号与分块序号；内容变化通过 contentHash 记录并在重建时覆盖。
 */
export function parseFatlossKnowledgeMarkdown(markdown: string): KnowledgeChunk[] {
  const sections = parseSections(markdown);
  return sections.flatMap(({ number, question, answer }) =>
    splitAnswer(answer).map((answerPart, chunkIndex) => {
      // 每块重复问题，避免长答案被拆分后脱离语义上下文，提升独立检索命中质量。
      const document = `问题：${question}\n\n回答：${answerPart}`;
      return {
        id: `${FATLOSS_KNOWLEDGE_SOURCE_ID}-${number}-${chunkIndex + 1}`,
        sourceId: FATLOSS_KNOWLEDGE_SOURCE_ID,
        sourceFile: FATLOSS_KNOWLEDGE_SOURCE_FILE,
        questionNumber: number,
        question,
        chunkIndex: chunkIndex + 1,
        document,
        contentHash: createHash("sha256").update(document).digest("hex"),
      };
    }),
  );
}
