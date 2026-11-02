import { existsSync, readFileSync } from "node:fs";

import { parse } from "csv-parse/sync";


interface FoodCsvRow {
    foodCode: string;
    foodName: string;
    energyKCal: string;
    protein: string;
    fat: string;
    CHO: string;
    dietaryFiber: string;
}

export interface FoodCompositionItem {
    code: string;
    name: string;
    energyKcalPer100g: number;
    proteinGPer100g: number | null;
    carbsGPer100g: number | null;
    fatGPer100g: number | null;
    fiberGPer100g: number | null;
}

export type FoodLookupResult =
    | { status: "matched"; item: FoodCompositionItem }
    | { status: "needs_clarification"; candidates: FoodCompositionItem[] }
    | { status: "not_found" | "data_unavailable" };

function nutrient(value: string): number | null {
    // 原数据中的 Tr/Trace 表示痕量，这里按 0 参与换算；空值和 “-” 保持未知。
    const normalized = value.trim();
    if (!normalized || normalized === "-" || normalized.toLowerCase() === "null") return null;
    if (/^tr(?:ace)?$/i.test(normalized)) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeFoodName(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/[\s·•，,。.!！、()（）\[\]【】_-]/g, "");
}

function editDistance(left: string, right: string): number {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let diagonal = previous[0];
        previous[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const above = previous[rightIndex];
            previous[rightIndex] = Math.min(
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + 1,
                diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
            diagonal = above;
        }
    }
    return previous[right.length];
}

function similarity(left: string, right: string): number {
    if (!left || !right) return 0;
    return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

/** 懒加载本地数据；缺文件不会阻止应用启动。 */
export class FoodCompositionCatalog {
    private items?: FoodCompositionItem[];

    constructor(readonly path: string) {}

    lookup(query: string): FoodLookupResult {
        const items = this.load();
        if (!items) return { status: "data_unavailable" };
        const normalizedQuery = normalizeFoodName(query);
        if (!normalizedQuery) return { status: "not_found" };
        // 匹配优先级固定为：规范化精确匹配 → 双向包含 → 编辑距离模糊匹配。
        // 同一层出现多个合理候选时返回澄清状态，绝不静默替用户选择。
        const exact = items.filter((item) => normalizeFoodName(item.name) === normalizedQuery);
        if (exact.length === 1) return { status: "matched", item: exact[0] };
        if (exact.length > 1) return { status: "needs_clarification", candidates: exact.slice(0, 5) };

        const contained = items.filter((item) => {
            const name = normalizeFoodName(item.name);
            return name.includes(normalizedQuery) || normalizedQuery.includes(name);
        });
        if (contained.length === 1) return { status: "matched", item: contained[0] };
        if (contained.length > 1) return { status: "needs_clarification", candidates: contained.slice(0, 5) };

        const ranked = items.map((item) => ({ item, score: similarity(normalizedQuery, normalizeFoodName(item.name)) }))
            .filter(({ score }) => score >= 0.72)
            .sort((left, right) => right.score - left.score)
            .slice(0, 5);
        if (ranked.length === 0) return { status: "not_found" };
        if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.12) return { status: "matched", item: ranked[0].item };
        return { status: "needs_clarification", candidates: ranked.map(({ item }) => item) };
    }

    private load(): FoodCompositionItem[] | null {
        if (this.items) return this.items;
        // 数据由用户手动同步；缺文件时返回 null，让上层自然降级到联网估算。
        if (!existsSync(this.path)) return null;
        const rows = parse(readFileSync(this.path), { columns: true, bom: true, skip_empty_lines: true, trim: true }) as FoodCsvRow[];
        this.items = rows.flatMap((row) => {
            const energy = nutrient(row.energyKCal);
            if (energy === null || !row.foodName?.trim()) return [];
            return [{
                code: row.foodCode,
                name: row.foodName.trim(),
                energyKcalPer100g: energy,
                proteinGPer100g: nutrient(row.protein),
                carbsGPer100g: nutrient(row.CHO),
                fatGPer100g: nutrient(row.fat),
                fiberGPer100g: nutrient(row.dietaryFiber),
            }];
        });
        return this.items;
    }
}

function scaled(value: number | null, grams: number): number | null {
    return value === null ? null : Math.round(value * grams) / 100;
}

export function scaleFoodComposition(item: FoodCompositionItem, grams: number) {
    if (!Number.isFinite(grams) || grams <= 0) throw new Error("食物克数必须大于 0");
    // 数据集口径是每 100 克可食部分，因此所有营养素都使用同一确定性比例换算。
    return {
        caloriesKcal: Math.round(item.energyKcalPer100g * grams) / 100,
        proteinG: scaled(item.proteinGPer100g, grams),
        carbsG: scaled(item.carbsGPer100g, grams),
        fatG: scaled(item.fatGPer100g, grams),
        fiberG: scaled(item.fiberGPer100g, grams),
    };
}
