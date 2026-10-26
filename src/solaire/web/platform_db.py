"""SQLite storage for role-based platform state."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from solaire.web import recent_projects

SCHEMA_VERSION = 12

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
  must_change_password INTEGER NOT NULL DEFAULT 0,
  teacher_guide_step INTEGER NOT NULL DEFAULT 0,
  avatar_data_url TEXT,
  preferences_json TEXT,
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

CREATE TABLE IF NOT EXISTS content_folders (
  id TEXT PRIMARY KEY,
  owner_teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('template', 'compose', 'paper')),
  parent_id TEXT REFERENCES content_folders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL DEFAULT 'category' CHECK(kind IN ('category', 'paper')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_folders_owner_scope ON content_folders(owner_teacher_id, scope, parent_id);

CREATE TABLE IF NOT EXISTS content_folder_items (
  owner_teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('template', 'compose')),
  item_id TEXT NOT NULL,
  folder_id TEXT NOT NULL REFERENCES content_folders(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_teacher_id, scope, item_id)
);

CREATE TABLE IF NOT EXISTS content_tags (
  id TEXT PRIMARY KEY,
  owner_teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_teacher_id, name)
);
CREATE TABLE IF NOT EXISTS content_tag_links (
  tag_id TEXT NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('bank', 'template', 'compose', 'paper')),
  item_id TEXT NOT NULL,
  PRIMARY KEY(tag_id, scope, item_id)
);
CREATE INDEX IF NOT EXISTS idx_content_tag_links_item ON content_tag_links(scope, item_id);

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
  folder_id TEXT REFERENCES content_folders(id) ON DELETE SET NULL,
  UNIQUE(exam_id, subject)
);

CREATE TABLE IF NOT EXISTS exam_publications (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES paper_records(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  start_at TEXT,
  end_at TEXT,
  show_results_immediately INTEGER NOT NULL DEFAULT 0,
  randomize_questions INTEGER NOT NULL DEFAULT 0,
  randomize_answers INTEGER NOT NULL DEFAULT 0,
  submission_mode TEXT NOT NULL DEFAULT 'online',
  max_screen_switches INTEGER NOT NULL DEFAULT 0,
  time_limit_minutes INTEGER,
  practice_kind TEXT,
  source_publication_ids_json TEXT,
  folder_id TEXT REFERENCES content_folders(id) ON DELETE SET NULL,
  recipient_scope TEXT NOT NULL DEFAULT 'class' CHECK(recipient_scope IN ('class', 'student')),
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
  question_payload_json TEXT,
  answer_key_json TEXT,
  practice_metadata_json TEXT,
  question_payload_version INTEGER NOT NULL DEFAULT 1,
  grading_completed_at TEXT,
  grading_completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(publication_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  answer_payload TEXT NOT NULL,
  is_correct INTEGER,
  score REAL,
  grading_status TEXT NOT NULL DEFAULT 'pending',
  feedback TEXT,
  ai_suggested_score REAL,
  ai_feedback TEXT,
  ai_ocr_text TEXT,
  graded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  graded_at TEXT,
  responded_at TEXT NOT NULL,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS paper_answer_grading_versions (
  attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempt_scan_images (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(attempt_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_attempt_scan_images_attempt_page
ON attempt_scan_images(attempt_id, page_index);

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

CREATE INDEX IF NOT EXISTS idx_proctor_events_attempt_type_time
ON proctor_events(attempt_id, event_type, occurred_at);

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
        previous_version = int(con.execute("PRAGMA user_version").fetchone()[0])
        if 0 < previous_version < SCHEMA_VERSION:
            backup_dir = platform_db_path(root).parent / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            with sqlite3.connect(backup_dir / f"platform-before-v{SCHEMA_VERSION}-{stamp}.db") as backup:
                con.backup(backup)
        con.executescript(SCHEMA_SQL)
        _ensure_column(con, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(con, "users", "teacher_guide_step", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(con, "users", "avatar_data_url", "TEXT")
        _ensure_column(con, "users", "preferences_json", "TEXT")
        _ensure_column(con, "students", "user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL")
        _ensure_column(con, "students", "initial_password", "TEXT")
        _ensure_column(con, "exam_publications", "submission_mode", "TEXT NOT NULL DEFAULT 'online'")
        _ensure_column(con, "exam_publications", "max_screen_switches", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(con, "exam_publications", "time_limit_minutes", "INTEGER")
        _ensure_column(con, "exam_publications", "practice_kind", "TEXT")
        _ensure_column(con, "exam_publications", "source_publication_ids_json", "TEXT")
        _ensure_column(con, "exam_publications", "subject", "TEXT")
        _ensure_column(con, "exam_publications", "folder_id", "TEXT REFERENCES content_folders(id) ON DELETE SET NULL")
        _ensure_column(con, "exam_publications", "recipient_scope", "TEXT NOT NULL DEFAULT 'class'")
        _ensure_column(con, "paper_records", "folder_id", "TEXT REFERENCES content_folders(id) ON DELETE SET NULL")
        if previous_version < 12:
            con.execute("DROP TRIGGER IF EXISTS publication_classes_one_active_per_paper")
            con.executescript("""
            CREATE TRIGGER publication_classes_one_active_per_paper
            BEFORE INSERT ON publication_classes
            WHEN EXISTS (
              SELECT 1 FROM publication_classes pc
              JOIN exam_publications old_ep ON old_ep.id=pc.publication_id
              JOIN exam_publications new_ep ON new_ep.id=NEW.publication_id
              WHERE pc.class_id=NEW.class_id AND old_ep.paper_id=new_ep.paper_id
                AND old_ep.status<>'revoked' AND old_ep.recipient_scope='class'
                AND new_ep.recipient_scope='class'
            )
            BEGIN SELECT RAISE(ABORT, 'paper already published to class'); END;
            """)
            con.execute("DROP TRIGGER IF EXISTS one_active_attempt_per_paper_folder")
            con.executescript("""
            CREATE TRIGGER one_active_attempt_per_paper_folder
            BEFORE INSERT ON student_attempts
            WHEN EXISTS (
              SELECT 1 FROM exam_publications incoming
              JOIN content_folders f ON f.id=incoming.folder_id
              JOIN student_attempts prior ON prior.student_id=NEW.student_id
              JOIN exam_publications existing ON existing.id=prior.publication_id
              WHERE incoming.id=NEW.publication_id AND f.kind='paper'
                AND existing.folder_id=incoming.folder_id AND existing.status<>'revoked'
            )
            BEGIN SELECT RAISE(ABORT, 'student already assigned in paper folder'); END;
            """)
        _ensure_column(con, "student_answers", "grading_status", "TEXT NOT NULL DEFAULT 'pending'")
        _ensure_column(con, "student_answers", "feedback", "TEXT")
        _ensure_column(con, "student_answers", "ai_suggested_score", "REAL")
        _ensure_column(con, "student_answers", "ai_feedback", "TEXT")
        _ensure_column(con, "student_answers", "ai_ocr_text", "TEXT")
        _ensure_column(con, "student_answers", "graded_by", "TEXT REFERENCES users(id) ON DELETE SET NULL")
        _ensure_column(con, "student_answers", "graded_at", "TEXT")
        _ensure_column(con, "student_attempts", "question_payload_json", "TEXT")
        _ensure_column(con, "student_attempts", "answer_key_json", "TEXT")
        _ensure_column(con, "student_attempts", "practice_metadata_json", "TEXT")
        _ensure_column(con, "student_attempts", "question_payload_version", "INTEGER NOT NULL DEFAULT 1")
        _ensure_column(con, "student_attempts", "grading_completed_at", "TEXT")
        _ensure_column(con, "student_attempts", "grading_completed_by", "TEXT REFERENCES users(id) ON DELETE SET NULL")
        # Keep legacy records readable after the subject model became mandatory.
        con.execute("UPDATE paper_records SET subject = '通用' WHERE subject IS NULL OR TRIM(subject) = '' OR subject = '未分科'")
        con.execute("UPDATE exam_publications SET subject = (SELECT subject FROM paper_records WHERE id = exam_publications.paper_id) WHERE subject IS NULL OR TRIM(subject) = '' OR subject = '未分科'")
        # Existing papers remain in an ordinary folder; historical publications retain their records.
        con.execute("""
            INSERT OR IGNORE INTO content_folders(id, owner_teacher_id, scope, parent_id, kind, name, created_at, updated_at)
            SELECT 'paper-default-' || id, id, 'paper', NULL, 'category', '默认文件夹', created_at, updated_at
            FROM users WHERE role = 'teacher'
        """)
        con.execute("""
            UPDATE paper_records SET folder_id = 'paper-default-' || owner_teacher_id
            WHERE folder_id IS NULL AND owner_teacher_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM users WHERE id = owner_teacher_id AND role = 'teacher')
        """)
        con.execute("""
            UPDATE exam_publications SET folder_id = (SELECT folder_id FROM paper_records WHERE id = exam_publications.paper_id)
            WHERE folder_id IS NULL
        """)
        _dedupe_active_publication_classes(con)
        con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def _ensure_column(con: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    rows = con.execute(f"PRAGMA table_info({table})").fetchall()
    if column not in {str(row["name"]) for row in rows}:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _dedupe_active_publication_classes(con: sqlite3.Connection) -> None:
    rows = con.execute(
        """
        SELECT ep.id, ep.paper_id, pc.class_id
        FROM exam_publications ep
        JOIN publication_classes pc ON pc.publication_id = ep.id
        WHERE ep.status <> 'revoked' AND ep.recipient_scope = 'class'
        ORDER BY ep.paper_id, pc.class_id, ep.created_at DESC, ep.id DESC
        """
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    duplicate_links: list[tuple[str, str]] = []
    for row in rows:
        key = (str(row["paper_id"]), str(row["class_id"]))
        publication_id = str(row["id"])
        if key in seen:
            duplicate_links.append((publication_id, str(row["class_id"])))
        else:
            seen.add(key)
    if duplicate_links:
        con.executemany(
            "DELETE FROM publication_classes WHERE publication_id = ? AND class_id = ?",
            duplicate_links,
        )
        affected = sorted({publication_id for publication_id, _ in duplicate_links})
        placeholders = ",".join("?" for _ in affected)
        con.execute(
            f"""
            UPDATE exam_publications
            SET status = 'revoked', updated_at = datetime('now')
            WHERE status <> 'revoked'
              AND recipient_scope = 'class'
              AND id IN ({placeholders})
              AND id NOT IN (SELECT DISTINCT publication_id FROM publication_classes)
            """,
            affected,
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}
