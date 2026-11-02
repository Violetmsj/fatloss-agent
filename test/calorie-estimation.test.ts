import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createResearchResourceLoader, RESEARCH_TOOL_ALLOWLIST } from "../src/pi/calorie-researcher.ts";
import { ValidatedCalorieResearcher as PiCalorieResearcher, type CalorieResearcher } from "../src/calorie-researcher.ts";
import { calculateActiveCaloriesFromMet, calculateMetRange, normalizeWearableCalories } from "../src/exercise-calculation.ts";
import { FoodCompositionCatalog, scaleFoodComposition } from "../src/food-composition.ts";
import { estimateFoodNutrition } from "../src/nutrition-estimation.ts";

const fixture = join(import.meta.dirname, "fixtures/food-composition.csv");

test("本地食物数据支持精确匹配、相近候选和每百克确定性换算", () => {
    const catalog = new FoodCompositionCatalog(fixture);
    const rice = catalog.lookup(" 大 米 ");
    assert.equal(rice.status, "matched");
    if (rice.status !== "matched") return;
    assert.deepEqual(scaleFoodComposition(rice.item, 150), {
        caloriesKcal: 519,
        proteinG: 11.85,
        carbsG: 115.8,
        fatG: 1.35,
        fiberG: 0.9,
    });
    const eggs = catalog.lookup("鸡蛋");
    assert.equal(eggs.status, "matched");
    if (eggs.status === "matched") assert.equal(eggs.item.fiberGPer100g, 0);
    assert.equal(catalog.lookup("鸡").status, "needs_clarification");
});

test("数据缺失或混合菜无匹配时降级到注入的联网研究器", async () => {
    let description = "";
    const researcher: CalorieResearcher = {
        async estimateFood(value) {
            description = value;
            return {
                caloriesKcal: 650, lowKcal: 520, highKcal: 800,
                proteinG: 32, carbsG: 70, fatG: 25, fiberG: null,
                sourceUrls: ["https://example.test/food"], assumptions: ["普通外卖份量"], confidence: "medium",
                needsClarification: false, clarificationQuestion: null,
            };
        },
        async findExerciseMet() { throw new Error("不应调用"); },
    };
    const result = await estimateFoodNutrition("一份黄焖鸡米饭", null, new FoodCompositionCatalog(fixture), researcher);
    assert.equal(description, "一份黄焖鸡米饭");
    assert.equal(result.status, "estimated");
    if (result.status === "estimated") {
        assert.equal(result.sourceType, "web_estimate");
        assert.equal(result.caloriesKcal, 650);
        assert.equal(result.requiresConfirmation, true);
    }
});

test("估算子 Agent 的 JSON 失败时只修复一次", async () => {
    const turns: string[] = [];
    const researcher = new PiCalorieResearcher(async (_kind, prompt) => {
        turns.push(prompt);
        if (turns.length === 1) return "not json";
        return JSON.stringify({
            caloriesKcal: 100, lowKcal: 80, highKcal: 120,
            proteinG: null, carbsG: null, fatG: null, fiberG: null,
            sourceUrls: ["https://example.test"], assumptions: [], confidence: "low",
            needsClarification: false, clarificationQuestion: null,
        });
    });
    assert.equal((await researcher.estimateFood("测试食物")).caloriesKcal, 100);
    assert.equal(turns.length, 2);

    const alwaysBad = new PiCalorieResearcher(async () => "bad");
    await assert.rejects(alwaysBad.estimateFood("测试食物"));
});

test("估算子 Agent 资源只加载内联 web_search，不继承项目上下文和 Skill", async () => {
    const loader = await createResearchResourceLoader();
    const extensions = loader.getExtensions().extensions;
    assert.equal(extensions.length, 1);
    assert.deepEqual([...extensions[0].tools.keys()], ["web_search"]);
    assert.deepEqual(RESEARCH_TOOL_ALLOWLIST, ["web_search"]);
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    assert.deepEqual(loader.getSkills().skills, []);
    assert.deepEqual(loader.getPrompts().prompts, []);
});

test("运动活动热量由固定 MET 公式计算，设备活动/总量/未知口径分开处理", () => {
    assert.equal(calculateActiveCaloriesFromMet(8, 70, 30), 257.25);
    assert.deepEqual(calculateMetRange(8, 7, 9, 70, 30, "medium"), {
        caloriesKcal: 257.25, lowKcal: 220.5, highKcal: 294,
        confidence: "medium",
        note: "按 Compendium 口径，以 (MET - 1) 计算活动热量；结果不叠加到 TDEE。",
        requiresConfirmation: true,
    });
    assert.deepEqual(normalizeWearableCalories(300, "active", 70, 60), {
        caloriesKcal: 300, lowKcal: null, highKcal: null, confidence: null,
        note: "采用设备报告的活动热量。", requiresConfirmation: false,
    });
    assert.equal(normalizeWearableCalories(300, "total", 70, 60).caloriesKcal, 230);
    assert.equal(normalizeWearableCalories(300, "unknown", 70, 60).confidence, "low");
});
