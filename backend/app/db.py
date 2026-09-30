from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
FIXTURES = DATA / "fixtures"

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  language TEXT NOT NULL DEFAULT 'ru',
  is_demo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions issued by phone + one-time-code login. A verified session may see every
-- case booked under the same normalized phone; booking-issued tokens are not verified.
CREATE TABLE IF NOT EXISTS patient_logins (
  token TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  current_revision_id TEXT,
  selected_program_id TEXT,
  consultation_reason TEXT,
  requested_services_json TEXT NOT NULL DEFAULT '[]',
  requested_changes_json TEXT NOT NULL DEFAULT '[]',
  preferred_date TEXT,
  notes TEXT,
  owner_id TEXT,
  language TEXT NOT NULL DEFAULT 'ru',
  is_demo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  scope TEXT NOT NULL,
  text_version TEXT NOT NULL,
  granted INTEGER NOT NULL,
  actor TEXT,
  granted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questionnaire_revisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  doctor_note TEXT,
  active_fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS therapists (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  therapist_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  consultation_reason TEXT,
  revision_id TEXT,
  idempotency_key TEXT,
  payload_fingerprint TEXT,
  requested_at TEXT,
  confirmed_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_slot_live
  ON appointments(slot_id) WHERE status != 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS ux_idem
  ON appointments(case_id, idempotency_key);

CREATE TABLE IF NOT EXISTS physician_plans (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  revision_id TEXT,
  author_doctor_id TEXT NOT NULL,
  template_id TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  services_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'unapproved',
  mode TEXT NOT NULL DEFAULT 'demo',
  approved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS route_items (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  procedure_code TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  resource TEXT,
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  feasible INTEGER NOT NULL,
  outcome TEXT,
  is_demo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  plan_id TEXT,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  observed_on TEXT,
  title TEXT NOT NULL,
  original_text TEXT,
  review_status TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  reference_range TEXT,
  assertion TEXT NOT NULL,
  source_span TEXT
);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  analytics_session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  event_source TEXT NOT NULL,
  operation_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_analytics_operation
  ON analytics_events(operation_key) WHERE operation_key IS NOT NULL;
"""


def db_path() -> Path:
    override = os.environ.get("PRIME_DB")
    if override:
        return Path(override)
    return DATA / "demo.sqlite"


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def audit(conn: sqlite3.Connection, case_id: str | None, actor: str, action: str, payload: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO domain_events (id, case_id, actor, action, at, payload_json) VALUES (?,?,?,?,datetime('now'),?)",
        (new_id("evt"), case_id, actor, action, json.dumps(payload or {}, ensure_ascii=False)),
    )


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    if conn is None:
        conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
        seed(conn)
        ensure_generated_slots(conn)
        # Demo superuser for testing/showing the CRM (coordinator + doctor rights). Idempotent.
        conn.execute(
            "INSERT OR IGNORE INTO staff_sessions (token, role, display_name) VALUES ('demo-admin', 'admin', 'Администратор')"
        )
        refresh_display_names(conn)
        conn.commit()
        from app.demo_population import ensure_synthetic_population, synthetic_enabled

        if synthetic_enabled():
            ensure_synthetic_population(conn)
    finally:
        if own:
            conn.close()


def refresh_display_names(conn: sqlite3.Connection) -> None:
    """Bring an existing demo DB in line with fixture names (no 'demo' labels in the UI)."""
    bundle = _load("backend_cases.json") or {}
    for patient in bundle.get("patients", []):
        conn.execute(
            "UPDATE patients SET display_name = ?, contact_name = ? WHERE id = ? AND display_name LIKE 'Demo%'",
            (patient["display_name"], patient.get("contact_name"), patient["id"]),
        )
    therapist = _load("therapist.json") or {}
    if therapist:
        conn.execute("UPDATE therapists SET display_name = ? WHERE id = ?", (therapist["display_name"], therapist["id"]))
    for token, name in (("demo-doctor", "Врач"), ("demo-coordinator", "Координатор"), ("demo-admin", "Администратор")):
        conn.execute("UPDATE staff_sessions SET display_name = ? WHERE token = ?", (name, token))


def ensure_generated_slots(conn: sqlite3.Connection) -> None:
    """Demo calendar: weekday 09:00–17:30 Almaty (UTC+5) slots for Oct–Nov 2026, idempotent.

    Existing fixture slots keep their ids; ~25% of generated slots are deterministically
    blocked so the calendar shows realistic busy time. Synthetic, not real clinic capacity.
    """
    from datetime import date, datetime, timedelta, timezone
    import hashlib

    therapist = conn.execute("SELECT id FROM therapists ORDER BY id LIMIT 1").fetchone()
    if therapist is None:
        return
    tid = therapist["id"]
    existing = {row["starts_at"] for row in conn.execute("SELECT starts_at FROM slots WHERE therapist_id = ?", (tid,))}
    rows = []
    day = date(2026, 10, 1)
    end = date(2026, 11, 30)
    while day <= end:
        if day.weekday() < 5:
            for minutes in range(9 * 60, 17 * 60 + 30 + 1, 30):
                local = datetime(day.year, day.month, day.day, minutes // 60, minutes % 60)
                utc = local - timedelta(hours=5)
                starts = utc.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if starts in existing:
                    continue
                ends = (utc + timedelta(minutes=30)).replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                slot_id = f"gen-slot-{day.strftime('%m%d')}-{minutes // 60:02d}{minutes % 60:02d}"
                blocked = int(hashlib.sha1(slot_id.encode()).hexdigest(), 16) % 4 == 0
                rows.append((slot_id, tid, starts, ends, 1 if blocked else 0))
        day += timedelta(days=1)
    conn.executemany(
        "INSERT OR IGNORE INTO slots (id, therapist_id, starts_at, ends_at, blocked) VALUES (?,?,?,?,?)",
        rows,
    )
    conn.commit()


def _load(name: str) -> dict | list | None:
    path = FIXTURES / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def seed(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) AS n FROM patients").fetchone()["n"]
    if count:
        return
    conn.executemany(
        "INSERT INTO staff_sessions (token, role, display_name) VALUES (?,?,?)",
        [
            ("demo-doctor", "doctor", "Врач"),
            ("demo-coordinator", "coordinator", "Координатор"),
        ],
    )
    bundle = _load("backend_cases.json") or {}
    for patient in bundle.get("patients", []):
        conn.execute(
            "INSERT INTO patients (id, display_name, contact_name, phone, language, is_demo) VALUES (?,?,?,?,?,1)",
            (patient["id"], patient["display_name"], patient.get("contact_name"), patient.get("phone"), patient.get("language", "ru")),
        )
        conn.execute(
            "INSERT INTO owner_sessions (token, patient_id, created_at) VALUES (?,?,datetime('now'))",
            (patient["owner_token"], patient["id"]),
        )
    for case in bundle.get("cases", []):
        conn.execute(
            """INSERT INTO cases (
                id, patient_id, stage, current_revision_id, selected_program_id, consultation_reason,
                requested_services_json, requested_changes_json, preferred_date, notes, owner_id, language, is_demo, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))""",
            (
                case["id"],
                case["patient_id"],
                case["stage"],
                case.get("current_revision_id"),
                case.get("selected_program_id"),
                case.get("consultation_reason"),
                json.dumps(case.get("requested_services") or [], ensure_ascii=False),
                json.dumps(case.get("requested_changes") or [], ensure_ascii=False),
                case.get("preferred_date"),
                case.get("notes"),
                case.get("owner_id") or "demo-coordinator",
                case.get("language", "ru"),
            ),
        )
    for rev in bundle.get("revisions", []):
        conn.execute(
            """INSERT INTO questionnaire_revisions
            (id, case_id, kind, answers_json, doctor_note, active_fields_json, created_at)
            VALUES (?,?,?,?,?,?,datetime('now'))""",
            (
                rev["id"],
                rev["case_id"],
                rev.get("kind", "intake"),
                json.dumps(rev.get("answers") or {}, ensure_ascii=False),
                rev.get("doctor_note"),
                json.dumps(rev.get("active_fields") or [], ensure_ascii=False),
            ),
        )
    therapist = _load("therapist.json") or {}
    if therapist:
        conn.execute(
            "INSERT INTO therapists (id, display_name, is_demo, timezone) VALUES (?,?,1,?)",
            (therapist["id"], therapist["display_name"], therapist.get("timezone", "Asia/Almaty")),
        )
    for slot in _load("slots.json") or []:
        conn.execute(
            "INSERT INTO slots (id, therapist_id, starts_at, ends_at, blocked) VALUES (?,?,?,?,?)",
            (slot["id"], slot["therapist_id"], slot["starts_at"], slot["ends_at"], 1 if slot.get("blocked") else 0),
        )
    for appt in bundle.get("appointments", []):
        conn.execute(
            """INSERT INTO appointments (
                id, case_id, slot_id, status, consultation_reason, revision_id, idempotency_key,
                payload_fingerprint, requested_at, confirmed_at, is_demo
            ) VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,1)""",
            (
                appt["id"],
                appt["case_id"],
                appt["slot_id"],
                appt["status"],
                appt.get("consultation_reason"),
                appt.get("revision_id"),
                appt.get("idempotency_key"),
                appt.get("payload_fingerprint"),
                appt.get("confirmed_at"),
            ),
        )
    for consent in bundle.get("consents", []):
        conn.execute(
            """INSERT INTO consents (id, case_id, scope, text_version, granted, actor, granted_at)
            VALUES (?,?,?,?,?,?,datetime('now'))""",
            (
                consent.get("id") or f"consent-{consent['case_id']}-{consent['scope']}",
                consent["case_id"],
                consent["scope"],
                consent["text_version"],
                1 if consent.get("granted") else 0,
                consent.get("actor"),
            ),
        )
    _seed_journey(conn)
    conn.commit()


def _seed_journey(conn: sqlite3.Connection) -> None:
    plans = _load("plans.json") or []
    for plan in plans:
        conn.execute(
            """INSERT INTO physician_plans (
                id, case_id, revision_id, author_doctor_id, template_id, source_refs_json, services_json,
                status, approval_status, mode, approved_at, is_demo
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)""",
            (
                plan["id"],
                plan["case_id"],
                plan.get("revision_id"),
                plan.get("author_doctor_id", "demo-doctor"),
                plan.get("template_id"),
                json.dumps(plan.get("source_refs") or [], ensure_ascii=False),
                json.dumps(plan.get("services") or [], ensure_ascii=False),
                plan.get("status", "confirmed"),
                plan.get("approval_status", "unapproved"),
                plan.get("mode", "demo"),
                plan.get("approved_at"),
            ),
        )
    for item in _load("route_items.json") or []:
        conn.execute(
            """INSERT INTO route_items (
                id, case_id, plan_id, procedure_code, starts_at, ends_at, resource, prerequisites_json, feasible, outcome, is_demo
            ) VALUES (?,?,?,?,?,?,?,?,?,?,1)""",
            (
                item["id"],
                item["case_id"],
                item["plan_id"],
                item["procedure_code"],
                item.get("starts_at"),
                item.get("ends_at"),
                item.get("resource"),
                json.dumps(item.get("prerequisites") or [], ensure_ascii=False),
                1 if item.get("feasible", True) else 0,
                item.get("outcome"),
            ),
        )
    for task in _load("tasks.json") or []:
        conn.execute(
            """INSERT INTO tasks (id, case_id, plan_id, kind, action, due_at, status, source_json, completed_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                task["id"],
                task["case_id"],
                task.get("plan_id"),
                task["kind"],
                task["action"],
                task.get("due_at"),
                task.get("status", "active"),
                json.dumps(task.get("source") or {}, ensure_ascii=False),
                task.get("completed_at"),
            ),
        )
    for report in _load("reports.json") or []:
        conn.execute(
            """INSERT INTO reports (id, case_id, source_document_id, observed_on, title, original_text, review_status, is_demo)
            VALUES (?,?,?,?,?,?,?,1)""",
            (
                report["id"],
                report["case_id"],
                report["source_document_id"],
                report.get("observed_on"),
                report["title"],
                report.get("original_text"),
                report.get("review_status", "pending"),
            ),
        )
        for obs in report.get("observations") or []:
            conn.execute(
                """INSERT INTO observations (id, report_id, name, value, unit, reference_range, assertion, source_span)
                VALUES (?,?,?,?,?,?,?,?)""",
                (
                    obs["id"],
                    report["id"],
                    obs["name"],
                    obs.get("value"),
                    obs.get("unit"),
                    obs.get("reference_range"),
                    obs.get("assertion", "unknown"),
                    obs.get("source_span"),
                ),
            )
