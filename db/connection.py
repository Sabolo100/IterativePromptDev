import sqlite3
import os
import threading
from config import DB_PATH

_local = threading.local()


def get_connection():
    if not hasattr(_local, "conn") or _local.conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def _migrate(conn):
    """Add new columns to existing tables if they don't exist yet."""
    new_columns = [
        ("sessions", "domain_detected",          "TEXT"),
        ("sessions", "domain_en",                "TEXT"),
        ("sessions", "expert_title",             "TEXT"),
        ("sessions", "expert_description",       "TEXT"),
        ("sessions", "evaluation_criteria",      "TEXT"),
        ("sessions", "generated_evaluator_prompt","TEXT"),
        ("sessions", "domain_detector_ms",       "INTEGER DEFAULT 0"),
    ]
    existing = {
        row[1]
        for row in conn.execute("PRAGMA table_info(sessions)").fetchall()
    }
    for table, col, col_type in new_columns:
        if col not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
    conn.commit()


def init_db():
    conn = get_connection()
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path) as f:
        conn.executescript(f.read())
    _migrate(conn)
    conn.commit()
