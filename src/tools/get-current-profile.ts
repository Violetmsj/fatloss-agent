import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ProfileRepository } from "../database.ts";
import { formatProfile } from "../profile.ts";

/**
 * 创建模型可调用的当前画像读取工具。
 *
 * 仓储由扩展注入，而非在工具内自行创建，确保命令、自动建档和工具读取同一份 SQLite 数据。
 */
export function createGetCurrentProfileTool(repository: ProfileRepository) {
  return defineTool({
    name: "get_current_profile",
    label: "读取当前减脂画像",
    description: "读取当前用户保存在 SQLite 中的减脂画像与粗略周期估算。个性化建议前必须调用。",
    parameters: Type.Object({}),
    async execute() {
      const profile = repository.get();
      if (!profile) {
        return {
          content: [{ type: "text" as const, text: "尚未建立减脂画像。请提示用户输入 /onboard。" }],
          details: undefined,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatProfile(profile) }],
        details: profile,
      };
    },
  });
}
