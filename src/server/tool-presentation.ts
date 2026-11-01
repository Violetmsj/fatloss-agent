const TOOL_TITLES: Record<string, string> = {
  get_current_time: "获取当前时间",
  get_current_profile: "读取减脂画像",
  calculate_energy_needs: "计算每日热量需求",
  update_current_profile: "更新减脂画像",
  search_fatloss_knowledge: "检索减脂知识库",
  list_memories: "查询长期记忆",
  create_memory: "保存长期记忆",
  update_memory: "更新长期记忆",
  invalidate_memory: "失效长期记忆",
  delete_memory: "删除长期记忆",
  ask_user: "补充记录信息",
  estimate_food_nutrition: "估算食物营养",
  estimate_exercise_calories: "估算运动消耗",
  get_daily_record: "读取每日记录",
  list_daily_records: "查询每日记录",
  add_food_entry: "新增饮食记录",
  update_food_entry: "修改饮食记录",
  delete_food_entry: "删除饮食记录",
  add_exercise_entry: "新增运动记录",
  update_exercise_entry: "修改运动记录",
  delete_exercise_entry: "删除运动记录",
  delete_daily_record: "删除整日记录",
  generate_daily_report: "生成减脂日报",
  generate_weekly_report: "生成减脂周报",
  generate_monthly_report: "生成减脂月报",
  generate_yearly_report: "生成减脂年报",
  generate_custom_report: "生成自定义减脂报告",
  list_reports: "查询减脂报告",
  get_report: "读取减脂报告",
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
  if (toolName === "ask_user") {
    const questions = Array.isArray(input.questions) ? input.questions.slice(0, 3).map((value) => {
      if (!value || typeof value !== "object") return null;
      const question = value as Record<string, unknown>;
      return {
        id: typeof question.id === "string" ? question.id : "question",
        label: typeof question.label === "string" ? question.label : undefined,
        prompt: typeof question.prompt === "string" ? question.prompt : "请补充信息",
        allowOther: question.allowOther !== false,
        options: Array.isArray(question.options) ? question.options.slice(0, 8).flatMap((option) => {
          if (!option || typeof option !== "object") return [];
          const item = option as Record<string, unknown>;
          if (typeof item.value !== "string" || typeof item.label !== "string") return [];
          return [{ value: item.value, label: item.label, description: typeof item.description === "string" ? item.description : undefined }];
        }) : [],
      };
    }).filter(Boolean) : [];
    return { questions };
  }
  if (toolName.startsWith("estimate_")) return { 描述: input.foodDescription ?? input.exerciseDescription, 分量克数: input.grams, 运动时长分钟: input.durationMinutes };
  if (toolName === "get_daily_record") return { 日期: input.logDate };
  if (toolName === "list_daily_records") return { 开始日期: input.fromDate, 结束日期: input.toDate };
  if (toolName.includes("food_entry")) return { 日期: input.logDate, 记录ID: input.id, 食物: input.foodName, 餐次: input.mealType };
  if (toolName.includes("exercise_entry")) return { 日期: input.logDate, 记录ID: input.id, 运动: input.exerciseName, 时长分钟: input.durationMinutes };
  if (toolName === "delete_daily_record") return { 日期: input.logDate };
  if (toolName.startsWith("generate_") && toolName.endsWith("_report")) {
    return { 日期: input.date ?? input.month ?? input.year, 开始日期: input.fromDate, 结束日期: input.toDate, 更新报告: input.regenerate === true };
  }
  if (toolName === "get_report") return { 报告ID: input.id };
  if (toolName === "list_reports") return { 类型: input.type, 开始日期: input.fromDate, 结束日期: input.toDate };
  // 记忆证据可能含用户原话，Web 只展示操作名称，不平铺完整参数。
  if (toolName.includes("memory") || toolName.includes("remember") || toolName.includes("forget")) {
    return { 操作: getToolTitle(toolName) };
  }
  return {};
}

export function presentToolOutput(toolName: string, result?: unknown): { summary: string; reportUrl?: string } {
  if (toolName === "ask_user") return { summary: "等待用户回答问卷" };
  if ((toolName.startsWith("generate_") && toolName.endsWith("_report")) || toolName === "get_report") {
    const details = result && typeof result === "object" ? (result as { details?: unknown }).details : undefined;
    if (details && typeof details === "object") {
      const value = details as { reportId?: unknown; stale?: unknown; summaryStatus?: unknown };
      if (typeof value.reportId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.reportId)) {
        return {
          summary: `${getToolTitle(toolName)}完成${value.stale ? "，数据已变化，当前为历史快照" : ""}${value.summaryStatus === "failed" || value.summaryStatus === "pending" ? "，统计已保存，AI 总结尚未完成" : ""}`,
          reportUrl: `/reports/${value.reportId}`,
        };
      }
    }
  }
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
