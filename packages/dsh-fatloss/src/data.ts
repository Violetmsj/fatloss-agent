import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, linkSync, rmSync, constants } from "node:fs";
import { join } from "node:path";

/** 只向不存在的目标导入；SQLite backup 包含源库 WAL 中已经提交的事务。 */
export async function importData(sourceDirectory: string, destination: string): Promise<void> {
    const target = join(destination, "fatloss.sqlite");
    if (existsSync(target)) throw new Error("目标数据库已存在，不能重复导入或覆盖。");
    const sourcePath = join(sourceDirectory, "fatloss.sqlite");
    if (!existsSync(sourcePath)) throw new Error("没有找到可导入的减脂数据库。");
    mkdirSync(destination, { recursive: true });
    const staging = mkdtempSync(join(destination, ".import-"));
    const temporary = join(staging, "fatloss.sqlite");
    let copiedCsv = false;
    let committed = false;
    const targetCsv = join(destination, "reference/food-composition-full.csv");
    let source: DatabaseSync | undefined;
    try {
        source = new DatabaseSync(sourcePath, { readOnly: true });
        // 避免把任意 SQLite 文件当作完整的减脂库。
        source.prepare("SELECT id FROM profile LIMIT 1").get();
        await backup(source, temporary);
        const checked = new DatabaseSync(temporary, { readOnly: true });
        try {
            const check = checked.prepare("PRAGMA integrity_check").get();
            if (check?.integrity_check !== "ok") throw new Error("导入数据库完整性检查失败。");
        } finally { checked.close(); }
        const csv = join(sourceDirectory, "reference/food-composition-full.csv");
        if (existsSync(csv)) {
            mkdirSync(join(destination, "reference"), { recursive: true });
            copyFileSync(csv, targetCsv, constants.COPYFILE_EXCL);
            copiedCsv = true;
        }
        // 导入期间插件尚未启动；仍再次检查，禁止覆盖已经初始化的数据。
        if (existsSync(target)) throw new Error("目标数据库已初始化，导入已取消。");
        linkSync(temporary, target);
        committed = true;
    } finally {
        source?.close();
        rmSync(staging, { recursive: true, force: true });
        if (!committed && copiedCsv) rmSync(targetCsv, { force: true });
    }
}
