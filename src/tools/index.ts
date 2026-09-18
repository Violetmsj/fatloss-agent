import { ProfileRepository } from "../database.ts";
import { MemoryStore } from "../memory-store.ts";

import { createGetCurrentProfileTool } from "./get-current-profile.ts";
import { createSearchFatlossKnowledgeTool } from "./search-fatloss-knowledge.ts";
import { createUpdateCurrentProfileTool } from "./update-current-profile.ts";
import { createMemoryTools } from "./memories.ts";

/**
 * Agent 的模型工具统一在此处汇总。
 * 新增工具时只需在此创建并加入数组，扩展会自动注册并加入工具白名单。
 */
export function createFatlossTools(repository: ProfileRepository, memories = new MemoryStore(repository.db)) {
  // 工具清单统一交给扩展注册和加入白名单，避免实现了工具却没有对模型开放。
  return [createGetCurrentProfileTool(repository), createUpdateCurrentProfileTool(repository), createSearchFatlossKnowledgeTool(), ...createMemoryTools(memories)];
}
