from __future__ import annotations

import hashlib
import sqlite3

from fastapi import APIRouter, Request

from app.analytics import record_server_event
from app.consent import has_granted
from app.contracts import AppointmentBody
from app.db import audit, connect, new_id, transaction
from app.errors import ApiError
from app.sessions import Actor, current_actor, require_case

router = APIRouter()


def payload_fingerprint(body: AppointmentBody) -> str:
    raw = f"{body.slot_id}\0{body.revision_id}\0{body.consultation_reason}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _row_to_appointment(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "case_id": row["case_id"],
        "slot_id": row["slot_id"],
        "status": row["status"],
        "consultation_reason": row["consultation_reason"],
        "revision_id": row["revision_id"],
        "requested_at": row["requested_at"],
        "confirmed_at": row["confirmed_at"],
        "is_demo": True,
    }


def book_appointment(
    conn: sqlite3.Connection,
    *,
    case: sqlite3.Row,
    actor: Actor,
    body: AppointmentBody,
    idempotency_key: str,
) -> tuple[dict, bool]:
    """Reserve a therapist slot inside an open IMMEDIATE transaction.

    Returns (appointment, created_new).
    """
    if not has_granted(conn, case["id"], "clinic_transfer"):
        raise ApiError(403, "transfer_required", "Нужно согласие на передачу данных в клинику")

    if case["current_revision_id"] and body.revision_id != case["current_revision_id"]:
        raise ApiError(409, "stale_revision", "Анкета изменилась. Обновите страницу и повторите запись")

    fp = payload_fingerprint(body)
    existing = conn.execute(
        """SELECT * FROM appointments
        WHERE case_id = ? AND idempotency_key = ?""",
        (case["id"], idempotency_key),
    ).fetchone()
    if existing is not None:
        if existing["payload_fingerprint"] != fp:
            raise ApiError(
                409,
                "idempotency_mismatch",
                "Тот же ключ идемпотентности уже использован с другими данными",
            )
        return _row_to_appointment(existing), False

    slot = conn.execute("SELECT * FROM slots WHERE id = ?", (body.slot_id,)).fetchone()
    if slot is None:
        raise ApiError(404, "not_found", "Слот не найден")
    if slot["blocked"]:
        raise ApiError(409, "slot_conflict", "Это время уже занято. Выберите другой слот.")

    live = conn.execute(
        """SELECT id, case_id FROM appointments
        WHERE slot_id = ? AND status != 'cancelled' LIMIT 1""",
        (body.slot_id,),
    ).fetchone()
    if live is not None:
        raise ApiError(409, "slot_conflict", "Это время уже занято. Выберите другой слот.")

    appt_id = new_id("appt")
    status = "demo_confirmed"
    try:
        conn.execute(
            """INSERT INTO appointments (
                id, case_id, slot_id, status, consultation_reason, revision_id,
                idempotency_key, payload_fingerprint, requested_at, confirmed_at, is_demo
            ) VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),1)""",
            (
                appt_id,
                case["id"],
                body.slot_id,
                status,
                body.consultation_reason,
                body.revision_id,
                idempotency_key,
                fp,
            ),
        )
    except sqlite3.IntegrityError:
        raced = conn.execute(
            """SELECT * FROM appointments
            WHERE case_id = ? AND idempotency_key = ?""",
            (case["id"], idempotency_key),
        ).fetchone()
        if raced is not None and raced["payload_fingerprint"] == fp:
            return _row_to_appointment(raced), False
        raise ApiError(409, "slot_conflict", "Это время уже занято. Выберите другой слот.") from None

    conn.execute(
        "UPDATE cases SET stage = ?, consultation_reason = COALESCE(consultation_reason, ?) WHERE id = ?",
        ("therapist_booking_confirmed", body.consultation_reason, case["id"]),
    )
    audit(
        conn,
        case["id"],
        actor.token or actor.role,
        "appointment_confirmed",
        {"appointment_id": appt_id, "status": status},
    )
    row = conn.execute("SELECT * FROM appointments WHERE id = ?", (appt_id,)).fetchone()
    return _row_to_appointment(row), True


@router.post("/api/cases/{case_id}/appointments")
def create_appointment(case_id: str, body: AppointmentBody, request: Request) -> dict:
    idempotency_key = request.headers.get("idempotency-key") or request.headers.get("Idempotency-Key")
    if not idempotency_key or not idempotency_key.strip():
        raise ApiError(422, "validation", "Нужен заголовок Idempotency-Key", {"Idempotency-Key": "required"})

    analytics_session_id = request.headers.get("x-analytics-session")
    created = False
    appointment: dict

    with transaction() as conn:
        actor = current_actor(conn, request)
        case = require_case(conn, actor, case_id, "patient_book")
        appointment, created = book_appointment(
            conn,
            case=case,
            actor=actor,
            body=body,
            idempotency_key=idempotency_key.strip(),
        )
        if not analytics_session_id:
            analytics_session_id = actor.analytics_session_id

    if created:
        try:
            with connect() as aconn:
                record_server_event(
                    aconn,
                    analytics_session_id=analytics_session_id,
                    name="appointment_confirmed",
                    operation_key=appointment["id"],
                )
                aconn.commit()
        except Exception:
            pass

    return appointment
