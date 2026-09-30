from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Request

from app.db import connect, new_id
from app.errors import ApiError
from app.sessions import STAFF_ROLES, current_actor

router = APIRouter()

CLIENT_EVENTS = {
    "session_started",
    "page_viewed",
    "intake_started",
    "intake_step_viewed",
    "intake_step_completed",
    "intake_submitted",
    "overview_started",
    "overview_completed",
    "recommendations_viewed",
    "cta_clicked",
    "booking_opened",
    "slot_selected",
    "clinic_transfer_consented",
    "technical_error",
    "question_viewed",
    "question_answered",
}

SERVER_EVENTS = {"appointment_requested", "appointment_confirmed"}

FORBIDDEN_PROP_KEYS = {
    "answers",
    "doctor_note",
    "age",
    "age_years",
    "sex",
    "exam_applicability",
    "symptoms",
    "package_id",
    "slot_id",
    "case_id",
    "patient_id",
    "phone",
    "contact_name",
    "email",
    "starts_at",
    "reason",
    "consultation_reason",
}


def record_server_event(
    conn: sqlite3.Connection,
    *,
    analytics_session_id: str | None,
    name: str,
    operation_key: str,
) -> None:
    """Best-effort trusted conversion. Never raises into the booking transaction caller."""
    if name not in SERVER_EVENTS or not analytics_session_id:
        return
    try:
        conn.execute(
            """INSERT INTO analytics_sessions (id, started_at, last_seen_at)
            VALUES (?, datetime('now'), datetime('now'))
            ON CONFLICT(id) DO UPDATE SET last_seen_at = datetime('now')""",
            (analytics_session_id,),
        )
        conn.execute(
            """INSERT INTO analytics_events (
                event_id, analytics_session_id, name, occurred_at, props_json, event_source, operation_key
            ) VALUES (?,?,?,datetime('now'),'{}','server',?)""",
            (new_id("aev"), analytics_session_id, name, operation_key),
        )
    except sqlite3.IntegrityError:
        return
    except Exception:
        return


def ingest_client_events(conn: sqlite3.Connection, events: list[dict[str, Any]]) -> dict:
    accepted: list[str] = []
    rejected: list[dict] = []
    for event in events:
        name = event.get("name")
        props = event.get("props") or {}
        if name in SERVER_EVENTS:
            rejected.append({"event_id": event.get("event_id"), "code": "untrusted_event"})
            continue
        if name not in CLIENT_EVENTS:
            rejected.append({"event_id": event.get("event_id"), "code": "event_not_allowed"})
            continue
        if any(key in props for key in FORBIDDEN_PROP_KEYS):
            rejected.append({"event_id": event.get("event_id"), "code": "prop_not_allowed"})
            continue
        session_id = event.get("analytics_session_id")
        if not session_id:
            rejected.append({"event_id": event.get("event_id"), "code": "session_required"})
            continue
        try:
            conn.execute(
                """INSERT INTO analytics_sessions (id, started_at, last_seen_at)
                VALUES (?, datetime('now'), datetime('now'))
                ON CONFLICT(id) DO UPDATE SET last_seen_at = datetime('now')""",
                (session_id,),
            )
            conn.execute(
                """INSERT INTO analytics_events (
                    event_id, analytics_session_id, name, occurred_at, props_json, event_source, operation_key
                ) VALUES (?,?,?,?,?,'client',NULL)""",
                (
                    event["event_id"],
                    session_id,
                    name,
                    event.get("occurred_at"),
                    json.dumps(props, ensure_ascii=False),
                ),
            )
            accepted.append(event["event_id"])
        except sqlite3.IntegrityError:
            accepted.append(event["event_id"])
    return {"accepted": accepted, "rejected": rejected}


def funnel(conn: sqlite3.Connection, date_from: str | None, date_to: str | None) -> dict:
    clauses = ["event_source IN ('client','server')"]
    params: list[str] = []
    if date_from:
        clauses.append("occurred_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("occurred_at < ?")
        params.append(date_to)
    where = " AND ".join(clauses)

    def sessions(name: str) -> int:
        row = conn.execute(
            f"""SELECT COUNT(DISTINCT analytics_session_id) AS n FROM analytics_events
            WHERE {where} AND name = ?""",
            (*params, name),
        ).fetchone()
        return int(row["n"])

    started = sessions("intake_started")
    submitted = sessions("intake_submitted")
    preview = sessions("recommendations_viewed")
    booking = sessions("booking_opened")
    requested = sessions("appointment_requested")
    confirmed = sessions("appointment_confirmed")

    def rate(num: int, den: int) -> float | None:
        if den == 0:
            return None
        return round(num / den, 4)

    return {
        "from": date_from,
        "to": date_to,
        "unit": "sessions",
        "counts": {
            "intake_started": started,
            "intake_submitted": submitted,
            "recommendations_viewed": preview,
            "booking_opened": booking,
            "appointment_requested": requested,
            "appointment_confirmed": confirmed,
        },
        "rates": {
            "completion": rate(submitted, started),
            "preview_to_booking": rate(booking, preview),
            "request_conversion": rate(requested, booking),
            "confirmed_conversion": rate(confirmed, booking),
        },
        "is_demo": True,
    }


@router.post("/api/analytics/events")
def post_events(body: dict, request: Request) -> dict:
    events = body.get("events")
    if not isinstance(events, list):
        raise ApiError(422, "validation", "Нужен список events", {"events": "required"})
    with connect() as conn:
        result = ingest_client_events(conn, events)
        conn.commit()
    return {"is_demo": True, **result, "request_seen": bool(request.headers.get("x-analytics-session"))}


@router.get("/api/staff/analytics/funnel")
def get_funnel(request: Request, date_from: str | None = None, date_to: str | None = None) -> dict:
    with connect() as conn:
        actor = current_actor(conn, request)
        if actor.role not in STAFF_ROLES:
            raise ApiError(403, "forbidden", "Воронка доступна сотрудникам")
        return funnel(conn, date_from, date_to)
