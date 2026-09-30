from __future__ import annotations

import json
import sqlite3

from app.db import new_id

PROCESSING_TEXT = "demo-processing-v1"
TRANSFER_TEXT = "demo-transfer-v1"
REMINDER_TEXT = "demo-reminder-v1"

PROCESSING_COPY = (
    "Ваши ответы нужны для предварительного подбора. "
    "При передаче в клинику доступ получают уполномоченные сотрудники в рамках своей роли."
)


def record_consent(
    conn: sqlite3.Connection,
    *,
    case_id: str | None,
    scope: str,
    text_version: str,
    granted: bool,
    actor: str,
) -> str:
    consent_id = new_id("consent")
    conn.execute(
        """INSERT INTO consents (id, case_id, scope, text_version, granted, actor, granted_at)
        VALUES (?,?,?,?,?,?,datetime('now'))""",
        (consent_id, case_id, scope, text_version, 1 if granted else 0, actor),
    )
    return consent_id


def has_granted(conn: sqlite3.Connection, case_id: str, scope: str) -> bool:
    row = conn.execute(
        """SELECT granted FROM consents
        WHERE case_id = ? AND scope = ? ORDER BY granted_at DESC LIMIT 1""",
        (case_id, scope),
    ).fetchone()
    return bool(row and row["granted"])


def project_case(conn: sqlite3.Connection, case: sqlite3.Row, role: str) -> dict:
    appointment = conn.execute(
        """SELECT id, status, slot_id, confirmed_at FROM appointments
        WHERE case_id = ? AND status != 'cancelled' ORDER BY requested_at DESC LIMIT 1""",
        (case["id"],),
    ).fetchone()
    slot = None
    if appointment:
        slot = conn.execute("SELECT starts_at, ends_at FROM slots WHERE id = ?", (appointment["slot_id"],)).fetchone()
    patient = conn.execute("SELECT * FROM patients WHERE id = ?", (case["patient_id"],)).fetchone()
    base = {
        "case_id": case["id"],
        "patient_id": case["patient_id"],
        "display_name": patient["display_name"] if patient else None,
        "stage": case["stage"],
        "selected_program_id": case["selected_program_id"],
        "consultation_reason": case["consultation_reason"],
        "preferred_date": case["preferred_date"],
        "booked_starts_at": slot["starts_at"] if slot else None,
        "appointment_status": appointment["status"] if appointment else None,
        "appointment_id": appointment["id"] if appointment else None,
        "notes": case["notes"],
        "owner_id": case["owner_id"],
        "language": case["language"],
        "is_demo": True,
        "contact_name": patient["contact_name"] if patient else None,
        "phone": patient["phone"] if patient else None,
    }
    if role != "doctor":
        return base
    revision = None
    if case["current_revision_id"]:
        revision = conn.execute(
            "SELECT answers_json, doctor_note, active_fields_json, kind FROM questionnaire_revisions WHERE id = ?",
            (case["current_revision_id"],),
        ).fetchone()
    base["questionnaire"] = None
    if revision:
        base["questionnaire"] = {
            "answers": json.loads(revision["answers_json"]),
            "doctor_note": revision["doctor_note"],
            "active_fields": json.loads(revision["active_fields_json"]),
            "kind": revision["kind"],
        }
    return base
