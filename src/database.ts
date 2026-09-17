import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type Profile, type ProfileInput, validateProfile } from "./profile.ts";

const PROFILE_COLUMNS = `
  gender, age, weight_kg, height_cm, body_fat_pct, waist_cm, hip_cm,
  goal, target_body_fat_pct, daily_energy_deficit_kcal,
  diet_exercise_preference, activity_frequency, job_type,
  favorite_exercises_json, equipment_json, stair_response, focus_area,
  training_days_json, updated_at
`;

interface ProfileRow {
  gender: Profile["gender"];
  age: number;
  weight_kg: number;
  height_cm: number;
  body_fat_pct: number;
  waist_cm: number;
  hip_cm: number | null;
  goal: Profile["goal"];
  target_body_fat_pct: number;
  daily_energy_deficit_kcal: number;
  diet_exercise_preference: Profile["dietExercisePreference"];
  activity_frequency: Profile["activityFrequency"];
  job_type: Profile["jobType"];
  favorite_exercises_json: string;
  equipment_json: string;
  stair_response: Profile["stairResponse"];
  focus_area: Profile["focusArea"];
  training_days_json: string;
  updated_at: string;
}

function fromRow(row: ProfileRow): Profile {
  return {
    gender: row.gender,
    age: row.age,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    bodyFatPct: row.body_fat_pct,
    waistCm: row.waist_cm,
    hipCm: row.hip_cm,
    goal: row.goal,
    targetBodyFatPct: row.target_body_fat_pct,
    dailyEnergyDeficitKcal: row.daily_energy_deficit_kcal,
    dietExercisePreference: row.diet_exercise_preference,
    activityFrequency: row.activity_frequency,
    jobType: row.job_type,
    favoriteExercises: JSON.parse(row.favorite_exercises_json),
    equipment: JSON.parse(row.equipment_json),
    stairResponse: row.stair_response,
    focusArea: row.focus_area,
    trainingDays: JSON.parse(row.training_days_json),
    updatedAt: row.updated_at,
  };
}

export class ProfileRepository {
  readonly db: DatabaseSync;

  constructor(databasePath = resolve(process.cwd(), "data", "fatloss.sqlite")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        -- 个人项目只保留当前画像；id = 1 让数据库层也强制单用户语义。
        id INTEGER PRIMARY KEY CHECK (id = 1),
        gender TEXT NOT NULL,
        age INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        height_cm REAL NOT NULL,
        body_fat_pct REAL NOT NULL,
        waist_cm REAL NOT NULL,
        hip_cm REAL,
        goal TEXT NOT NULL,
        target_body_fat_pct REAL NOT NULL,
        daily_energy_deficit_kcal INTEGER NOT NULL,
        diet_exercise_preference TEXT NOT NULL,
        activity_frequency TEXT NOT NULL,
        job_type TEXT NOT NULL,
        favorite_exercises_json TEXT NOT NULL,
        equipment_json TEXT NOT NULL,
        stair_response TEXT NOT NULL,
        focus_area TEXT NOT NULL,
        training_days_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): Profile | null {
    const row = this.db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profile WHERE id = 1`).get() as ProfileRow | undefined;
    return row ? fromRow(row) : null;
  }

  save(input: ProfileInput): Profile {
    validateProfile(input);
    const updatedAt = new Date().toISOString();
    const values = [
      input.gender,
      input.age,
      input.weightKg,
      input.heightCm,
      input.bodyFatPct,
      input.waistCm,
      input.hipCm,
      input.goal,
      input.targetBodyFatPct,
      input.dailyEnergyDeficitKcal,
      input.dietExercisePreference,
      input.activityFrequency,
      input.jobType,
      // SQLite 没有数组类型，问卷多选答案以 JSON 数组保存并在 fromRow 中还原。
      JSON.stringify(input.favoriteExercises),
      JSON.stringify(input.equipment),
      input.stairResponse,
      input.focusArea,
      JSON.stringify(input.trainingDays),
      updatedAt,
    ];
    const statement = this.db.prepare(`
      INSERT INTO profile (id, ${PROFILE_COLUMNS}) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        gender = excluded.gender,
        age = excluded.age,
        weight_kg = excluded.weight_kg,
        height_cm = excluded.height_cm,
        body_fat_pct = excluded.body_fat_pct,
        waist_cm = excluded.waist_cm,
        hip_cm = excluded.hip_cm,
        goal = excluded.goal,
        target_body_fat_pct = excluded.target_body_fat_pct,
        daily_energy_deficit_kcal = excluded.daily_energy_deficit_kcal,
        diet_exercise_preference = excluded.diet_exercise_preference,
        activity_frequency = excluded.activity_frequency,
        job_type = excluded.job_type,
        favorite_exercises_json = excluded.favorite_exercises_json,
        equipment_json = excluded.equipment_json,
        stair_response = excluded.stair_response,
        focus_area = excluded.focus_area,
        training_days_json = excluded.training_days_json,
        updated_at = excluded.updated_at
    `);

    // 覆盖画像必须原子化：任何一步失败都保留上一份完整画像。
    this.db.exec("BEGIN IMMEDIATE");
    try {
      statement.run(...values);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ...input, updatedAt };
  }

  close(): void {
    this.db.close();
  }
}
