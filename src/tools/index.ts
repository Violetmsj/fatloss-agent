import { ProfileRepository } from "../database.ts";

import { createGetCurrentProfileTool } from "./get-current-profile.ts";
import { createSearchFatlossKnowledgeTool } from "./search-fatloss-knowledge.ts";
import { createUpdateCurrentProfileTool } from "./update-current-profile.ts";

/**
 * Agent 的模型工具统一在此处汇总。
 * 新增工具时只需在此创建并加入数组，扩展会自动注册并加入工具白名单。
 */
export function createFatlossTools(repository: ProfileRepository) {
  return [createGetCurrentProfileTool(repository), createUpdateCurrentProfileTool(repository), createSearchFatlossKnowledgeTool()];
}
