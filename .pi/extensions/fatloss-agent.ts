import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ProfileRepository } from "../../src/database.ts";
import { formatProfile } from "../../src/profile.ts";
import { runOnboarding } from "../../src/onboarding.ts";

export default function fatlossAgentExtension(pi: ExtensionAPI) {
  const repository = new ProfileRepository();
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

  pi.registerTool({
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
      return { content: [{ type: "text" as const, text: formatProfile(profile) }], details: profile };
    },
  });

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
    pi.setActiveTools(["get_current_profile"]);
    if (ctx.mode === "tui" && !repository.get()) {
      await startOnboarding(ctx);
    }
  });

  pi.on("session_shutdown", () => repository.close());
}
