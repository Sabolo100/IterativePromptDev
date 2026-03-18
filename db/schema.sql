CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    preset_name TEXT DEFAULT 'custom',
    status TEXT DEFAULT 'idle',  -- idle, detecting, running, paused, stopped, done
    mode TEXT DEFAULT 'auto',    -- auto, manual
    generator_model TEXT NOT NULL,
    evaluator_model TEXT NOT NULL,
    refiner_model TEXT NOT NULL,
    generator_system_prompt TEXT NOT NULL,
    evaluator_system_prompt TEXT NOT NULL,
    refiner_system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    max_iterations INTEGER DEFAULT 5,
    -- Dynamic evaluator fields (generated at session start)
    domain_detected TEXT,
    domain_en TEXT,
    expert_title TEXT,
    expert_description TEXT,
    evaluation_criteria TEXT,       -- JSON array of 6 domain-specific criteria names
    generated_evaluator_prompt TEXT, -- The dynamically written evaluator system prompt
    domain_detector_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS iterations (
    iteration_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    iteration_num INTEGER NOT NULL,
    prompt_text TEXT,
    output_text TEXT,
    evaluation_json TEXT,
    overall_score REAL,
    refined_prompt TEXT,
    status TEXT DEFAULT 'pending',  -- pending, generating, evaluating, refining, done
    generator_ms INTEGER DEFAULT 0,
    evaluator_ms INTEGER DEFAULT 0,
    refiner_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presets (
    preset_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    user_prompt TEXT NOT NULL,
    generator_system_prompt TEXT,
    evaluator_system_prompt TEXT,
    refiner_system_prompt TEXT,
    evaluation_criteria TEXT  -- JSON array
);

CREATE INDEX IF NOT EXISTS idx_iterations_session ON iterations(session_id, iteration_num);
