import type { DatabaseSync } from "node:sqlite";

import {
    normalizeExerciseInput,
    normalizeFoodInput,
    validateRecordDate,
    type DailyRecord,
    type DailyRecordDetails,
    type DailyRecordSummary,
    type ExerciseEntry,
    type ExerciseEntryInput,
    type FoodEntry,
    type FoodEntryInput,
    type MealType,
} from "./daily-record.ts";
import { calculateEnergyNeeds } from "./energy-calculation.ts";
import type { Profile } from "./profile.ts";

export { MEAL_TYPES } from "./daily-record.ts";
export type { DailyRecord, DailyRecordDetails, DailyRecordSummary, ExerciseEntry, ExerciseEntryInput, FoodEntry, FoodEntryInput, MealType } from "./daily-record.ts";

interface DailyRecordRow {
    id: number;
    log_date: string;
    bmr_kcal_snapshot: number;
    tdee_kcal_snapshot: number | null;
    intake_target_kcal_snapshot: number | null;
    created_at: string;
    updated_at: string;
}

interface FoodEntryRow {
    id: number;
    daily_record_id: number;
    meal_type: MealType;
    food_name: string;
    amount: number | null;
    unit: string | null;
    calories_kcal: number;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    eaten_at: string | null;
    note: string | null;
    created_at: string;
    updated_at: string;
}

interface ExerciseEntryRow {
    id: number;
    daily_record_id: number;
    exercise_name: string;
    duration_minutes: number;
    calories_burned_kcal: number;
    intensity: string | null;
    started_at: string | null;
    distance_km: number | null;
    note: string | null;
    created_at: string;
    updated_at: string;
}

const CREATE_DAILY_RECORD_TABLES = `
    CREATE TABLE IF NOT EXISTS daily_records (
        id INTEGER PRIMARY KEY,
        log_date TEXT NOT NULL UNIQUE,
        bmr_kcal_snapshot INTEGER NOT NULL CHECK (bmr_kcal_snapshot > 0),
        tdee_kcal_snapshot INTEGER CHECK (tdee_kcal_snapshot IS NULL OR tdee_kcal_snapshot > 0),
        intake_target_kcal_snapshot INTEGER CHECK (intake_target_kcal_snapshot IS NULL OR intake_target_kcal_snapshot > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_entries (
        id INTEGER PRIMARY KEY,
        daily_record_id INTEGER NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('早餐', '午餐', '晚餐', '加餐')),
        food_name TEXT NOT NULL CHECK (length(trim(food_name)) > 0),
        amount REAL CHECK (amount IS NULL OR amount > 0),
        unit TEXT CHECK (unit IS NULL OR length(trim(unit)) > 0),
        calories_kcal REAL NOT NULL CHECK (calories_kcal >= 0),
        protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
        carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
        fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
        fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
        eaten_at TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((amount IS NULL AND unit IS NULL) OR (amount IS NOT NULL AND unit IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS exercise_entries (
        id INTEGER PRIMARY KEY,
        daily_record_id INTEGER NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE,
        exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) > 0),
        duration_minutes REAL NOT NULL CHECK (duration_minutes > 0),
        calories_burned_kcal REAL NOT NULL CHECK (calories_burned_kcal >= 0),
        intensity TEXT CHECK (intensity IS NULL OR length(trim(intensity)) > 0),
        started_at TEXT,
        distance_km REAL CHECK (distance_km IS NULL OR distance_km > 0),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS food_entries_daily_meal ON food_entries(daily_record_id, meal_type);
    CREATE INDEX IF NOT EXISTS exercise_entries_daily ON exercise_entries(daily_record_id);
`;

export function initializeDailyRecordSchema(db: DatabaseSync): void {
    db.exec(CREATE_DAILY_RECORD_TABLES);
}

function fromDailyRow(row: DailyRecordRow): DailyRecord {
    return {
        id: row.id,
        logDate: row.log_date,
        bmrKcalSnapshot: row.bmr_kcal_snapshot,
        tdeeKcalSnapshot: row.tdee_kcal_snapshot,
        intakeTargetKcalSnapshot: row.intake_target_kcal_snapshot,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function fromFoodRow(row: FoodEntryRow): FoodEntry {
    return {
        id: row.id,
        dailyRecordId: row.daily_record_id,
        mealType: row.meal_type,
        foodName: row.food_name,
        amount: row.amount,
        unit: row.unit,
        caloriesKcal: row.calories_kcal,
        proteinG: row.protein_g,
        carbsG: row.carbs_g,
        fatG: row.fat_g,
        fiberG: row.fiber_g,
        eatenAt: row.eaten_at,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function fromExerciseRow(row: ExerciseEntryRow): ExerciseEntry {
    return {
        id: row.id,
        dailyRecordId: row.daily_record_id,
        exerciseName: row.exercise_name,
        durationMinutes: row.duration_minutes,
        caloriesBurnedKcal: row.calories_burned_kcal,
        intensity: row.intensity,
        startedAt: row.started_at,
        distanceKm: row.distance_km,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** 与画像和长期记忆共享 SQLite 连接；热量汇总始终从明细实时计算。 */
export class DailyRecordStore {
    constructor(readonly db: DatabaseSync, readonly now: () => number = Date.now) {
        db.exec("PRAGMA foreign_keys = ON");
        initializeDailyRecordSchema(db);
    }

    private transaction<T>(operation: () => T): T {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const result = operation();
            this.db.exec("COMMIT");
            return result;
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // 保留原始失败原因。
            }
            throw error;
        }
    }

    private dailyRowByDate(logDate: string): DailyRecordRow | undefined {
        return this.db.prepare("SELECT * FROM daily_records WHERE log_date = ?").get(logDate) as unknown as DailyRecordRow | undefined;
    }

    private ensureDailyRecord(logDate: string, profile: Profile, now: string): DailyRecord {
        const existing = this.dailyRowByDate(logDate);
        if (existing) return fromDailyRow(existing);
        const energy = calculateEnergyNeeds(profile);
        this.db.prepare(`
            INSERT INTO daily_records (
                log_date, bmr_kcal_snapshot, tdee_kcal_snapshot, intake_target_kcal_snapshot, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(logDate, energy.bmrKcal, energy.tdeeKcal, energy.intakeKcal, now, now);
        return fromDailyRow(this.dailyRowByDate(logDate)!);
    }

    getOrCreate(logDate: string, profile: Profile): DailyRecord {
        validateRecordDate(logDate);
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => this.ensureDailyRecord(logDate, profile, now));
    }

    getByDate(logDate: string): DailyRecordDetails | null {
        validateRecordDate(logDate);
        const row = this.dailyRowByDate(logDate);
        if (!row) return null;
        return this.details(fromDailyRow(row));
    }

    list(fromDate: string, toDate: string): DailyRecordSummary[] {
        validateRecordDate(fromDate);
        validateRecordDate(toDate);
        if (fromDate > toDate) throw new Error("开始日期不能晚于结束日期");
        const rows = this.db.prepare("SELECT * FROM daily_records WHERE log_date BETWEEN ? AND ? ORDER BY log_date ASC")
            .all(fromDate, toDate) as unknown as DailyRecordRow[];
        return rows.map((row) => this.summary(fromDailyRow(row)));
    }

    addFood(logDate: string, profile: Profile, input: FoodEntryInput): FoodEntry {
        validateRecordDate(logDate);
        const normalized = normalizeFoodInput(input);
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const day = this.ensureDailyRecord(logDate, profile, now);
            const result = this.db.prepare(`
                INSERT INTO food_entries (
                    daily_record_id, meal_type, food_name, amount, unit, calories_kcal,
                    protein_g, carbs_g, fat_g, fiber_g, eaten_at, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                day.id, normalized.mealType, normalized.foodName, normalized.amount, normalized.unit,
                normalized.caloriesKcal, normalized.proteinG, normalized.carbsG, normalized.fatG,
                normalized.fiberG, normalized.eatenAt, normalized.note, now, now,
            );
            this.touchDay(day.id, now);
            return this.foodById(Number(result.lastInsertRowid))!;
        });
    }

    updateFood(id: number, changes: Partial<FoodEntryInput>): FoodEntry {
        if (Object.keys(changes).length === 0) throw new Error("请至少提供一个需要更新的食物字段");
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const existing = this.foodById(id);
            if (!existing) throw new Error("食物记录不存在");
            const normalized = normalizeFoodInput({
                mealType: existing.mealType,
                foodName: existing.foodName,
                amount: existing.amount,
                unit: existing.unit,
                caloriesKcal: existing.caloriesKcal,
                proteinG: existing.proteinG,
                carbsG: existing.carbsG,
                fatG: existing.fatG,
                fiberG: existing.fiberG,
                eatenAt: existing.eatenAt,
                note: existing.note,
                ...changes,
            });
            this.db.prepare(`
                UPDATE food_entries SET
                    meal_type = ?, food_name = ?, amount = ?, unit = ?, calories_kcal = ?,
                    protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, eaten_at = ?, note = ?, updated_at = ?
                WHERE id = ?
            `).run(
                normalized.mealType, normalized.foodName, normalized.amount, normalized.unit,
                normalized.caloriesKcal, normalized.proteinG, normalized.carbsG, normalized.fatG,
                normalized.fiberG, normalized.eatenAt, normalized.note, now, id,
            );
            this.touchDay(existing.dailyRecordId, now);
            return this.foodById(id)!;
        });
    }

    deleteFood(id: number): boolean {
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const existing = this.foodById(id);
            if (!existing) return false;
            const deleted = this.db.prepare("DELETE FROM food_entries WHERE id = ?").run(id).changes > 0;
            if (deleted) this.touchDay(existing.dailyRecordId, now);
            return deleted;
        });
    }

    addExercise(logDate: string, profile: Profile, input: ExerciseEntryInput): ExerciseEntry {
        validateRecordDate(logDate);
        const normalized = normalizeExerciseInput(input);
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const day = this.ensureDailyRecord(logDate, profile, now);
            const result = this.db.prepare(`
                INSERT INTO exercise_entries (
                    daily_record_id, exercise_name, duration_minutes, calories_burned_kcal,
                    intensity, started_at, distance_km, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                day.id, normalized.exerciseName, normalized.durationMinutes, normalized.caloriesBurnedKcal,
                normalized.intensity, normalized.startedAt, normalized.distanceKm, normalized.note, now, now,
            );
            this.touchDay(day.id, now);
            return this.exerciseById(Number(result.lastInsertRowid))!;
        });
    }

    updateExercise(id: number, changes: Partial<ExerciseEntryInput>): ExerciseEntry {
        if (Object.keys(changes).length === 0) throw new Error("请至少提供一个需要更新的运动字段");
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const existing = this.exerciseById(id);
            if (!existing) throw new Error("运动记录不存在");
            const normalized = normalizeExerciseInput({
                exerciseName: existing.exerciseName,
                durationMinutes: existing.durationMinutes,
                caloriesBurnedKcal: existing.caloriesBurnedKcal,
                intensity: existing.intensity,
                startedAt: existing.startedAt,
                distanceKm: existing.distanceKm,
                note: existing.note,
                ...changes,
            });
            this.db.prepare(`
                UPDATE exercise_entries SET
                    exercise_name = ?, duration_minutes = ?, calories_burned_kcal = ?, intensity = ?,
                    started_at = ?, distance_km = ?, note = ?, updated_at = ?
                WHERE id = ?
            `).run(
                normalized.exerciseName, normalized.durationMinutes, normalized.caloriesBurnedKcal,
                normalized.intensity, normalized.startedAt, normalized.distanceKm, normalized.note, now, id,
            );
            this.touchDay(existing.dailyRecordId, now);
            return this.exerciseById(id)!;
        });
    }

    deleteExercise(id: number): boolean {
        const now = new Date(this.now()).toISOString();
        return this.transaction(() => {
            const existing = this.exerciseById(id);
            if (!existing) return false;
            const deleted = this.db.prepare("DELETE FROM exercise_entries WHERE id = ?").run(id).changes > 0;
            if (deleted) this.touchDay(existing.dailyRecordId, now);
            return deleted;
        });
    }

    deleteDay(logDate: string): boolean {
        validateRecordDate(logDate);
        return this.transaction(() => this.db.prepare("DELETE FROM daily_records WHERE log_date = ?").run(logDate).changes > 0);
    }

    private foodById(id: number): FoodEntry | null {
        const row = this.db.prepare("SELECT * FROM food_entries WHERE id = ?").get(id) as unknown as FoodEntryRow | undefined;
        return row ? fromFoodRow(row) : null;
    }

    private exerciseById(id: number): ExerciseEntry | null {
        const row = this.db.prepare("SELECT * FROM exercise_entries WHERE id = ?").get(id) as unknown as ExerciseEntryRow | undefined;
        return row ? fromExerciseRow(row) : null;
    }

    private touchDay(id: number, updatedAt: string): void {
        this.db.prepare("UPDATE daily_records SET updated_at = ? WHERE id = ?").run(updatedAt, id);
    }

    private summary(record: DailyRecord): DailyRecordSummary {
        const meals = this.db.prepare(`
            SELECT meal_type, coalesce(sum(calories_kcal), 0) AS calories
            FROM food_entries WHERE daily_record_id = ? GROUP BY meal_type
        `).all(record.id) as unknown as { meal_type: MealType; calories: number }[];
        const mealIntakeKcal: Record<MealType, number> = { 早餐: 0, 午餐: 0, 晚餐: 0, 加餐: 0 };
        for (const meal of meals) mealIntakeKcal[meal.meal_type] = meal.calories;
        const totalExerciseKcal = (this.db.prepare(`
            SELECT coalesce(sum(calories_burned_kcal), 0) AS calories FROM exercise_entries WHERE daily_record_id = ?
        `).get(record.id) as { calories: number }).calories;
        return {
            ...record,
            mealIntakeKcal,
            totalIntakeKcal: Object.values(mealIntakeKcal).reduce((total, value) => total + value, 0),
            totalExerciseKcal,
        };
    }

    private details(record: DailyRecord): DailyRecordDetails {
        const foodEntries = (this.db.prepare("SELECT * FROM food_entries WHERE daily_record_id = ? ORDER BY id ASC")
            .all(record.id) as unknown as FoodEntryRow[]).map(fromFoodRow);
        const exerciseEntries = (this.db.prepare("SELECT * FROM exercise_entries WHERE daily_record_id = ? ORDER BY id ASC")
            .all(record.id) as unknown as ExerciseEntryRow[]).map(fromExerciseRow);
        return { summary: this.summary(record), foodEntries, exerciseEntries };
    }
}
