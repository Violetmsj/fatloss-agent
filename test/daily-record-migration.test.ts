import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeDailyRecordSchema } from "../src/daily-record-store.ts";

test("旧版明细表会幂等补充来源字段且不改写已有数据", () => {
    const db = new DatabaseSync(":memory:");
    try {
        db.exec(`
            CREATE TABLE daily_records (id INTEGER PRIMARY KEY, log_date TEXT NOT NULL UNIQUE, bmr_kcal_snapshot INTEGER NOT NULL, tdee_kcal_snapshot INTEGER, intake_target_kcal_snapshot INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE food_entries (id INTEGER PRIMARY KEY, daily_record_id INTEGER NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE, meal_type TEXT NOT NULL, food_name TEXT NOT NULL, amount REAL, unit TEXT, calories_kcal REAL NOT NULL, protein_g REAL, carbs_g REAL, fat_g REAL, fiber_g REAL, eaten_at TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE exercise_entries (id INTEGER PRIMARY KEY, daily_record_id INTEGER NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE, exercise_name TEXT NOT NULL, duration_minutes REAL NOT NULL, calories_burned_kcal REAL NOT NULL, intensity TEXT, started_at TEXT, distance_km REAL, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            INSERT INTO daily_records VALUES (1, '2026-09-21', 1600, 2000, 1700, 'now', 'now');
            INSERT INTO food_entries VALUES (1, 1, '午餐', '米饭', 100, '克', 116, NULL, NULL, NULL, NULL, NULL, NULL, 'now', 'now');
            INSERT INTO exercise_entries VALUES (1, 1, '步行', 30, 100, NULL, NULL, NULL, NULL, 'now', 'now');
        `);
        initializeDailyRecordSchema(db);
        initializeDailyRecordSchema(db);
        const foodColumns = new Set((db.prepare("PRAGMA table_info(food_entries)").all() as { name: string }[]).map((row) => row.name));
        const exerciseColumns = new Set((db.prepare("PRAGMA table_info(exercise_entries)").all() as { name: string }[]).map((row) => row.name));
        assert.ok(foodColumns.has("calorie_confidence"));
        assert.ok(exerciseColumns.has("reported_calorie_basis"));
        assert.equal(db.prepare("SELECT food_name FROM food_entries WHERE id = 1").get()?.food_name, "米饭");
        assert.equal(db.prepare("SELECT exercise_name FROM exercise_entries WHERE id = 1").get()?.exercise_name, "步行");
    } finally {
        db.close();
    }
});
