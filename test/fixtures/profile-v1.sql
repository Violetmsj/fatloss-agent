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
