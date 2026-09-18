const TOOL_TITLES: Record<string, string> = {
  get_current_time: "获取当前时间",
  get_current_profile: "读取减脂画像",
  update_current_profile: "更新减脂画像",
  search_fatloss_knowledge: "检索减脂知识库",
  list_memories: "查询长期记忆",
  create_memory: "保存长期记忆",
  update_memory: "更新长期记忆",
  invalidate_memory: "失效长期记忆",
  delete_memory: "删除长期记忆",
};

/** 把内部工具名转换成用户可理解的中文卡片标题。 */
export function getToolTitle(toolName: string): string {
  return TOOL_TITLES[toolName] ?? `执行 ${toolName}`;
}

export function presentToolInput(toolName: string, args: unknown): unknown {
  if (!args || typeof args !== "object") return {};
  const input = args as Record<string, unknown>;
  if (toolName === "search_fatloss_knowledge") return { 问题: input.question ?? input.query ?? "减脂知识" };
  if (toolName === "update_current_profile") return { 更新字段: Object.keys(input) };
  // 记忆证据可能含用户原话，Web 只展示操作名称，不平铺完整参数。
  if (toolName.includes("memory") || toolName.includes("remember") || toolName.includes("forget")) {
    return { 操作: getToolTitle(toolName) };
  }
  return {};
}

export function presentToolOutput(toolName: string): { summary: string } {
  return { summary: `${getToolTitle(toolName)}完成` };
}

function resultText(value: unknown): string | undefined {
  // SDK 的错误既可能是纯字符串，也可能位于 ToolResult.content 文本块中。
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const block = item as { type?: unknown; text?: unknown };
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    }).join("\n");
    return text || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const result = value as { content?: unknown; message?: unknown; error?: unknown };
  if (typeof result.message === "string") return result.message;
  if (typeof result.error === "string") return result.error;
  return resultText(result.content);
}

export function presentToolError(toolName: string, result: unknown): string {
  const detail = resultText(result)?.replace(/\s+/g, " ").trim().slice(0, 300);
  return detail ? `${getToolTitle(toolName)}失败：${detail}` : `${getToolTitle(toolName)}失败，请重试。`;
}
