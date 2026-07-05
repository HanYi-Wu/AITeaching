"""SQLite storage for role-based platform state."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from solaire.web import recent_projects

SCHEMA_VERSION = 2

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'school', 'teacher', 'student')),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_school_role ON users(school_id, role);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  UNIQUE(teacher_id, subject)
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade TEXT,
  subject_hint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  student_no TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  initial_password TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(school_id, student_no)
);

CREATE TABLE IF NOT EXISTS class_students (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY(class_id, student_id)
);

CREATE TABLE IF NOT EXISTS teacher_class_assignments (
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  PRIMARY KEY(teacher_id, class_id, subject)
);

CREATE TABLE IF NOT EXISTS paper_records (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'offline' CHECK(delivery_mode IN ('offline', 'online')),
  owner_teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(exam_id, subject)
);

CREATE TABLE IF NOT EXISTS exam_publications (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES paper_records(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT,
  end_at TEXT,
  show_results_immediately INTEGER NOT NULL DEFAULT 0,
  randomize_questions INTEGER NOT NULL DEFAULT 0,
  randomize_answers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_classes (
  publication_id TEXT NOT NULL REFERENCES exam_publications(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY(publication_id, class_id)
);

CREATE TABLE IF NOT EXISTS student_attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES exam_publications(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  started_at TEXT,
  submitted_at TEXT,
  score REAL,
  max_score REAL,
  time_spent_seconds INTEGER,
  UNIQUE(publication_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  answer_payload TEXT NOT NULL,
  is_correct INTEGER,
  score REAL,
  responded_at TEXT NOT NULL,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS proctor_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES exam_publications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  duration_ms INTEGER,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
"""


def default_platform_root() -> Path:
    """Application-level storage root for platform accounts and sessions."""
    return recent_projects.app_data_dir() / "platform"


def platform_db_path(root: Path) -> Path:
    return root / ".solaire" / "platform.db"


def connect(root: Path) -> sqlite3.Connection:
    path = platform_db_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_platform_db(root: Path) -> None:
    with connect(root) as con:
        con.executescript(SCHEMA_SQL)
        _ensure_column(con, "students", "user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL")
        _ensure_column(con, "students", "initial_password", "TEXT")
        con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def _ensure_column(con: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    rows = con.execute(f"PRAGMA table_info({table})").fetchall()
    if column not in {str(row["name"]) for row in rows}:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}
