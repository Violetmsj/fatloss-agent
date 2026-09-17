import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { ProfileRepository } from "../../src/database.ts";
import { formatProfile } from "../../src/profile.ts";
import { runOnboarding } from "../../src/onboarding.ts";
import { createFatlossTools } from "../../src/tools/index.ts";

export default function fatlossAgentExtension(pi: ExtensionAPI) {
  // 一个 pi 进程共享一个仓储连接，命令、自动建档和模型工具读取同一份 SQLite 画像。
  const repository = new ProfileRepository();
  const tools = createFatlossTools(repository);
  const activeToolNames = tools.map((tool) => tool.name);
  let onboardingInProgress = false;

  const startOnboarding = async (ctx: ExtensionContext) => {
    if (onboardingInProgress) {
      ctx.ui.notify("建档正在进行中。", "warning");
      return;
    }
    onboardingInProgress = true;
    try {
      const profile = await runOnboarding(ctx, (input) => repository.save(input));
      if (profile) {
        ctx.ui.notify("减脂画像已保存。之后可输入 /profile 查看，或直接开始聊天。", "info");
      }
    } finally {
      onboardingInProgress = false;
    }
  };

  // 工具定义与扩展生命周期分离；新增工具只需加入 src/tools/index.ts。
  for (const tool of tools) pi.registerTool(tool);

  pi.registerCommand("onboard", {
    description: "填写或覆盖当前减脂画像",
    handler: async (_args, ctx) => startOnboarding(ctx),
  });

  pi.registerCommand("profile", {
    description: "查看当前减脂画像",
    handler: async (_args, ctx) => {
      const profile = repository.get();
      ctx.ui.notify(profile ? formatProfile(profile) : "尚未建立减脂画像，请输入 /onboard 开始。", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    // 扩展加载阶段还不能调整工具集，必须等 session_start 运行时初始化完成后设置白名单。
    pi.setActiveTools(activeToolNames);
    if (ctx.mode === "tui" && !repository.get()) {
      await startOnboarding(ctx);
    }
  });

  pi.on("session_shutdown", () => repository.close());
}
