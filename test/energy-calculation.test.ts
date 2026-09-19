import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Value } from "typebox/value";

import { ProfileRepository } from "../src/database.ts";
import { calculateEnergyNeeds } from "../src/energy-calculation.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { ACTIVITY_LEVELS, formatProfile, type ProfileInput } from "../src/profile.ts";
import { createCalculateEnergyNeedsTool } from "../src/tools/calculate-energy-needs.ts";
import { createFatlossTools } from "../src/tools/index.ts";
import { createUpdateCurrentProfileTool } from "../src/tools/update-current-profile.ts";

const profile: ProfileInput = {
    gender: "男", age: 30, heightCm: 175, weightKg: 70, bodyFatPct: 25,
    waistCm: 85, hipCm: null, goal: "减脂", targetBodyFatPct: 20,
    dailyEnergyDeficitKcal: 500, dietExercisePreference: "吃动平衡派",
    activityLevel: "中度", jobType: "轻体力工作", favoriteExercises: ["步行"],
    equipment: ["不使用器械"], stairResponse: "几乎没感觉", focusArea: "全身",
    trainingDays: ["一", "三", "五"],
};

test("固定公式保留中间精度，男性与女性仅在最终结果取整", () => {
    const male = calculateEnergyNeeds(profile);
    assert.equal(male.bmrKcal, 1649);
    assert.equal(male.tdeeKcal, 2556);
    assert.equal(male.intakeKcal, 2056);
    const female = calculateEnergyNeeds({ ...profile, gender: "女" });
    assert.equal(female.bmrKcal, 1483);
    assert.equal(female.tdeeKcal, 2298);
    assert.equal(female.intakeKcal, 1798);
});

test("四档系数固定，工作类型和计划训练日不额外增加消耗", () => {
    const factors = [1.2, 1.375, 1.55, 1.725];
    for (const [index, activityLevel] of ACTIVITY_LEVELS.entries()) {
        const result = calculateEnergyNeeds({ ...profile, activityLevel });
        assert.equal(result.activityFactor, factors[index]);
        assert.equal(result.tdeeKcal, Math.round(1648.75 * factors[index]!));
        assert.deepEqual(result, calculateEnergyNeeds({
            ...profile, activityLevel, jobType: "重体力工作", trainingDays: ["二", "四", "六", "日"],
        }));
    }
});

test("保持体型采用零缺口，且不修改画像原缺口", () => {
    const input = { ...profile, goal: "保持体型" as const };
    const result = calculateEnergyNeeds(input);
    assert.equal(result.appliedDeficitKcal, 0);
    assert.equal(result.input.dailyEnergyDeficitKcal, 500);
    assert.equal(result.intakeKcal, result.tdeeKcal);
    assert.equal(input.dailyEnergyDeficitKcal, 500);
});

test("活动水平缺失仅返回代谢参考，非法输入报错且合法最低边界可计算", () => {
    const result = calculateEnergyNeeds({ ...profile, activityLevel: null });
    assert.equal(result.bmrKcal, 1649);
    assert.equal(result.tdeeKcal, null);
    assert.equal(result.intakeKcal, null);
    assert.equal(result.activityFactor, null);
    assert.match(result.notes.join("\n"), /补充活动水平/);
    assert.throws(() => calculateEnergyNeeds({ ...profile, weightKg: NaN }), /体重/);
    assert.throws(() => calculateEnergyNeeds({ ...profile, activityLevel: "未知" } as never), /活动水平/);
    // 现有画像合法范围内，公式最小值仍为正数 39；更低的输入应先由画像校验拒绝。
    assert.equal(calculateEnergyNeeds({ ...profile, gender: "女", weightKg: 20, heightCm: 80, age: 100 }).bmrKcal, 39);
    assert.throws(() => calculateEnergyNeeds({ ...profile, weightKg: 0 }), /体重/);
});

test("摄入计算非正时保留代谢和消耗，不截为零或修改缺口", () => {
    const result = calculateEnergyNeeds({ ...profile, weightKg: 40, heightCm: 140, age: 80, gender: "女", activityLevel: "久坐", dailyEnergyDeficitKcal: 1000 });
    assert.equal(result.bmrKcal, 714);
    assert.equal(result.tdeeKcal, 857);
    assert.equal(result.intakeKcal, null);
    assert.equal(result.appliedDeficitKcal, 1000);
    assert.match(result.notes.join("\n"), /摄入.*非正数/);
});

function createLegacyDatabase(path: string): void {
    const db = new DatabaseSync(path);
    db.exec(readFileSync(new URL("./fixtures/profile-v1.sql", import.meta.url), "utf8"));
    db.prepare(`INSERT INTO profile VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        profile.gender, profile.age, profile.weightKg, profile.heightCm, profile.bodyFatPct,
        profile.waistCm, profile.hipCm, profile.goal, profile.targetBodyFatPct,
        profile.dailyEnergyDeficitKcal, profile.dietExercisePreference, "经常锻炼", profile.jobType,
        JSON.stringify(profile.favoriteExercises), JSON.stringify(profile.equipment), profile.stairResponse,
        profile.focusArea, JSON.stringify(profile.trainingDays), "2026-09-19T00:00:00.000Z",
    );
    new MemoryStore(db);
    db.exec("UPDATE memory_state SET revision = 17 WHERE id = 1");
    db.exec(`INSERT INTO memories VALUES ('legacy-memory', '喜欢清淡饮食', '喜欢清淡饮食', '偏好', '[]', 'explicit', 'active', '2026-09-19', '2026-09-19', NULL, 1)`);
    db.close();
}

test("旧画像迁移保留数据、时间和记忆，补选前可局部更新且重复打开无损", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fatloss-energy-legacy-"));
    const path = join(dir, "profile.sqlite");
    createLegacyDatabase(path);
    const repository = new ProfileRepository(path);
    try {
        assert.deepEqual(repository.get(), { ...profile, activityLevel: null, updatedAt: "2026-09-19T00:00:00.000Z" });
        assert.match(formatProfile(repository.get()!), /活动水平待补充/);
        assert.equal(repository.db.prepare("SELECT legacy_activity_frequency AS value FROM profile").get()?.value, "经常锻炼");
        assert.equal(repository.db.prepare("SELECT revision FROM memory_state WHERE id = 1").get()?.revision, 17);
        assert.equal(repository.db.prepare("SELECT content FROM memories WHERE id = 'legacy-memory'").get()?.content, "喜欢清淡饮食");
        const tool = createCalculateEnergyNeedsTool(repository);
        const incomplete = await tool.execute("legacy", {}, undefined, undefined, {} as never);
        assert.equal(incomplete.details.bmrKcal, 1649);
        assert.equal(incomplete.details.tdeeKcal, null);
        repository.update({ weightKg: 71 });
        assert.equal(repository.get()?.activityLevel, null);
        assert.throws(() => repository.update({ activityLevel: null } as never), /活动水平/);
        assert.throws(() => repository.save({ ...profile, activityLevel: null } as never), /活动水平/);
        const result = await createUpdateCurrentProfileTool(repository).execute("update", { activityLevel: "轻度" }, undefined, undefined, {} as never);
        assert.equal(result.details.after.activityLevel, "轻度");
        assert.equal(repository.get()?.weightKg, 71);
        const complete = await tool.execute("complete", {}, undefined, undefined, {} as never);
        assert.equal(complete.details.activityFactor, 1.375);
        assert.equal(complete.details.tdeeKcal, 2281);
        const before = repository.get();
        const reopened = new ProfileRepository(path);
        try { assert.deepEqual(reopened.get(), before); } finally { reopened.close(); }
        assert.equal(repository.db.prepare("SELECT legacy_activity_frequency AS value FROM profile").get()?.value, "经常锻炼");
    } finally {
        repository.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test("迁移中途失败时回滚旧表和数据，下次仍可迁移", (context) => {
    const dir = mkdtempSync(join(tmpdir(), "fatloss-energy-rollback-"));
    const path = join(dir, "profile.sqlite");
    createLegacyDatabase(path);
    const originalExec = DatabaseSync.prototype.exec;
    const mock = context.mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync, sql: string) {
        if (sql.includes("INSERT INTO profile (id,")) throw new Error("模拟迁移复制失败");
        return originalExec.call(this, sql);
    });
    try {
        assert.throws(() => new ProfileRepository(path), /模拟迁移复制失败/);
        mock.mock.restore();
        const db = new DatabaseSync(path);
        try {
            assert.equal(db.prepare("SELECT activity_frequency FROM profile").get()?.activity_frequency, "经常锻炼");
            assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'profile_legacy'").get(), undefined);
            assert.equal(db.prepare("SELECT revision FROM memory_state").get()?.revision, 17);
        } finally { db.close(); }
        const repository = new ProfileRepository(path);
        try { assert.equal(repository.get()?.activityLevel, null); } finally { repository.close(); }
    } finally {
        mock.mock.restore();
        rmSync(dir, { recursive: true, force: true });
    }
});

test("计算工具注册、拒绝覆盖参数、读取最新画像且不写库", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fatloss-energy-tool-"));
    const repository = new ProfileRepository(join(dir, "profile.sqlite"));
    try {
        const tool = createCalculateEnergyNeedsTool(repository);
        assert.ok(createFatlossTools(repository).some((item) => item.name === tool.name));
        assert.equal(Value.Check(tool.parameters, {}), true);
        assert.equal(Value.Check(tool.parameters, { activityFactor: 2 }), false);
        await assert.rejects(() => tool.execute("missing", {}, undefined, undefined, {} as never), /尚未建立/);
        repository.save(profile);
        const before = repository.get();
        const changes = repository.db.prepare("SELECT total_changes() AS n").get()?.n;
        const result = await tool.execute("calculate", {}, undefined, undefined, {} as never);
        assert.deepEqual(result.details, calculateEnergyNeeds(profile));
        const block = result.content[0]!;
        assert.equal(block.type, "text");
        assert.deepEqual(JSON.parse(block.text), result.details);
        assert.deepEqual(repository.get(), before);
        assert.equal(repository.db.prepare("SELECT total_changes() AS n").get()?.n, changes);
        repository.update({ weightKg: 80 });
        const updated = await tool.execute("recalculate", {}, undefined, undefined, {} as never);
        assert.equal(updated.details.input.weightKg, 80);
        assert.equal(updated.details.bmrKcal, 1749);
    } finally {
        repository.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
