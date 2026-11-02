import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { resolveDataDirectory } from "../src/host/data-directory.ts";

import { parse } from "csv-parse/sync";

const COMMIT = "d15675c27582748307023b7ee7aca2a63fc52756";
const EXPECTED_SHA256 = "7f89bfde478b1ae8a9109eab7d9842e7e87d378a947e3a50b0eaa819c554dcf4";
const EXPECTED_ROWS = 1677;
const URL = `https://raw.githubusercontent.com/Sanotsu/china-food-composition-data/${COMMIT}/json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/food_composition_full.csv`;
const { values } = parseArgs({ options: { "data-directory": { type: "string" } } });
const directory = resolveDataDirectory(values["data-directory"]);
const target = join(directory, "reference/food-composition-full.csv");
const metadata = join(directory, "reference/food-composition-full.meta.json");

async function main(): Promise<void> {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`下载食物数据失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // 同时锁定提交、文件摘要和记录数，避免上游文件被替换后静默改变估算口径。
    if (sha256 !== EXPECTED_SHA256) throw new Error(`SHA-256 校验失败：${sha256}`);
    const rows = parse(bytes, { columns: true, bom: true, skip_empty_lines: true }) as unknown[];
    if (rows.length !== EXPECTED_ROWS) throw new Error(`数据条数校验失败：期望 ${EXPECTED_ROWS}，实际 ${rows.length}`);

    mkdirSync(dirname(target), { recursive: true });
    const suffix = `${process.pid}-${Date.now()}.tmp`;
    const temporaryData = `${target}.${suffix}`;
    const temporaryMetadata = `${metadata}.${suffix}`;
    try {
        // 先写同目录临时文件，再 rename 覆盖，下载或写盘中断时不会留下半份正式数据。
        writeFileSync(temporaryData, bytes, { flag: "wx" });
        writeFileSync(temporaryMetadata, JSON.stringify({ source: URL, commit: COMMIT, sha256, rows: rows.length, syncedAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
        renameSync(temporaryData, target);
        renameSync(temporaryMetadata, metadata);
    } finally {
        rmSync(temporaryData, { force: true });
        rmSync(temporaryMetadata, { force: true });
    }
    console.log(`已同步 ${rows.length} 条食物成分数据到 ${target}`);
}

await main();
