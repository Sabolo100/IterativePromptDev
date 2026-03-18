import json
import uuid
from datetime import datetime
from db.connection import get_connection


# --- Sessions ---

def create_session(*, preset_name="custom", mode="auto", generator_model, evaluator_model,
                   refiner_model, generator_system_prompt, evaluator_system_prompt,
                   refiner_system_prompt, user_prompt, max_iterations=5):
    conn = get_connection()
    session_id = str(uuid.uuid4())[:8]
    conn.execute(
        """INSERT INTO sessions (session_id, preset_name, status, mode,
           generator_model, evaluator_model, refiner_model,
           generator_system_prompt, evaluator_system_prompt, refiner_system_prompt,
           user_prompt, max_iterations)
           VALUES (?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (session_id, preset_name, mode, generator_model, evaluator_model, refiner_model,
         generator_system_prompt, evaluator_system_prompt, refiner_system_prompt,
         user_prompt, max_iterations)
    )
    conn.commit()
    return session_id


def get_session(session_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def list_sessions():
    conn = get_connection()
    rows = conn.execute(
        "SELECT session_id, preset_name, status, mode, generator_model, user_prompt, max_iterations, created_at "
        "FROM sessions ORDER BY created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def update_session_status(session_id, status):
    conn = get_connection()
    conn.execute(
        "UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?",
        (status, datetime.now().isoformat(), session_id)
    )
    conn.commit()


def delete_session(session_id):
    conn = get_connection()
    conn.execute("DELETE FROM iterations WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()


# --- Iterations ---

def create_iteration(session_id, iteration_num, prompt_text):
    conn = get_connection()
    conn.execute(
        "INSERT INTO iterations (session_id, iteration_num, prompt_text, status) VALUES (?, ?, ?, 'pending')",
        (session_id, iteration_num, prompt_text)
    )
    conn.commit()
    return conn.execute(
        "SELECT iteration_id FROM iterations WHERE session_id = ? AND iteration_num = ?",
        (session_id, iteration_num)
    ).fetchone()["iteration_id"]


def update_iteration(iteration_id, **kwargs):
    conn = get_connection()
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values())
    vals.append(iteration_id)
    conn.execute(f"UPDATE iterations SET {sets} WHERE iteration_id = ?", vals)
    conn.commit()


def get_iterations(session_id):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM iterations WHERE session_id = ? ORDER BY iteration_num",
        (session_id,)
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("evaluation_json"):
            try:
                d["evaluation"] = json.loads(d["evaluation_json"])
            except json.JSONDecodeError:
                d["evaluation"] = {"raw": d["evaluation_json"]}
        result.append(d)
    return result


def get_last_iteration(session_id):
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM iterations WHERE session_id = ? ORDER BY iteration_num DESC LIMIT 1",
        (session_id,)
    ).fetchone()
    return dict(row) if row else None


# --- Presets ---

def list_presets():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM presets ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def get_preset(preset_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM presets WHERE preset_id = ?", (preset_id,)).fetchone()
    return dict(row) if row else None


def upsert_preset(preset_id, name, description, user_prompt,
                  generator_system_prompt=None, evaluator_system_prompt=None,
                  refiner_system_prompt=None, evaluation_criteria=None):
    conn = get_connection()
    conn.execute(
        """INSERT OR REPLACE INTO presets
           (preset_id, name, description, user_prompt,
            generator_system_prompt, evaluator_system_prompt, refiner_system_prompt,
            evaluation_criteria)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (preset_id, name, description, user_prompt,
         generator_system_prompt, evaluator_system_prompt, refiner_system_prompt,
         json.dumps(evaluation_criteria) if evaluation_criteria else None)
    )
    conn.commit()


# --- Config ---

def get_config(key, default=None):
    conn = get_connection()
    row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
    if row:
        try:
            return json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            return row["value"]
    return default


def set_config(key, value):
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)",
        (key, json.dumps(value), datetime.now().isoformat())
    )
    conn.commit()


def update_session_domain(session_id, *, domain_detected, domain_en, expert_title,
                          expert_description, evaluation_criteria,
                          generated_evaluator_prompt, domain_detector_ms=0):
    """Store the dynamically generated evaluator info on the session."""
    conn = get_connection()
    conn.execute(
        """UPDATE sessions SET
               domain_detected = ?,
               domain_en = ?,
               expert_title = ?,
               expert_description = ?,
               evaluation_criteria = ?,
               generated_evaluator_prompt = ?,
               domain_detector_ms = ?,
               updated_at = ?
           WHERE session_id = ?""",
        (domain_detected, domain_en, expert_title, expert_description,
         json.dumps(evaluation_criteria, ensure_ascii=False) if evaluation_criteria else None,
         generated_evaluator_prompt, domain_detector_ms,
         datetime.now().isoformat(), session_id)
    )
    conn.commit()
