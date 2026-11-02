import { defineTool } from "./definition.ts";
import { Type } from "typebox";

import { ProfileRepository } from "../database.ts";
import { calculateEnergyNeeds } from "../energy-calculation.ts";

export function createCalculateEnergyNeedsTool(repository: ProfileRepository) {
    return defineTool({
        name: "calculate_energy_needs",
        label: "计算每日热量需求",
        description: "读取最新减脂画像，以固定 Mifflin–St Jeor 公式计算基础代谢参考值（静息代谢估算）、每日总消耗及摄入参考。个人热量数值必须使用本工具，不得自行估算；不接受输入覆盖，不修改画像。返回 bmrKcal、tdeeKcal、intakeKcal 的单位均为千卡/日，null 表示不可用，必须说明 notes 中的原因。",
        parameters: Type.Object({}, { additionalProperties: false }),
        async execute() {
            const profile = repository.get();
            if (!profile) throw new Error("尚未建立减脂画像，请先打开 DSH 侧栏的减脂陪伴页面完成建档。");
            const result = calculateEnergyNeeds(profile);
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result) }],
                details: result,
            };
        },
    });
}
