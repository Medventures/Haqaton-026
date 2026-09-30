from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass

from fastapi import Request

from app.errors import ApiError


@dataclass
class Actor:
    role: str
    token: str | None
    patient_id: str | None
    display_name: str | None
    analytics_session_id: str | None
    verified_phone: str | None = None


# Staff roles. "admin" is a demo-only superuser (coordinator + doctor rights) for testing and showing.
STAFF_ROLES = {"coordinator", "doctor", "admin"}


def is_doctor(actor: "Actor") -> bool:
    return actor.role in {"doctor", "admin"}


def is_coordinator(actor: "Actor") -> bool:
    return actor.role in {"coordinator", "admin"}


def demo_enabled() -> bool:
    return os.environ.get("PRIME_DEMO", "1") != "0"


def current_actor(conn: sqlite3.Connection, request: Request) -> Actor:
    token = request.headers.get("x-owner-session") or request.cookies.get("prime_owner")
    analytics = request.headers.get("x-analytics-session")
    if not token:
        return Actor("anonymous", None, None, None, analytics)
    staff = conn.execute("SELECT role, display_name FROM staff_sessions WHERE token = ?", (token,)).fetchone()
    if staff:
        return Actor(staff["role"], token, None, staff["display_name"], analytics)
    owner = conn.execute("SELECT patient_id FROM owner_sessions WHERE token = ?", (token,)).fetchone()
    if owner:
        login = conn.execute("SELECT phone FROM patient_logins WHERE token = ?", (token,)).fetchone()
        return Actor("patient", token, owner["patient_id"], None, analytics, login["phone"] if login else None)
    raise ApiError(401, "session_invalid", "Сессия не найдена")


def normalize_phone(raw: str | None) -> str | None:
    """Return +7XXXXXXXXXX for Kazakhstan-style numbers, else None."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 11 and digits[0] in {"7", "8"}:
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    else:
        return None
    return "+" + digits


def _same_verified_phone(conn: sqlite3.Connection, actor: Actor, patient_id: str) -> bool:
    """Verified (code-login) sessions may open cases booked under the same phone."""
    if not actor.verified_phone:
        return False
    row = conn.execute("SELECT phone FROM patients WHERE id = ?", (patient_id,)).fetchone()
    return bool(row) and normalize_phone(row["phone"]) == actor.verified_phone


def require_case(conn: sqlite3.Connection, actor: Actor, case_id: str, action: str) -> sqlite3.Row:
    case = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if case is None:
        raise ApiError(404, "not_found", "Запись не найдена")
    patient_actions = {"patient_read", "patient_book", "patient_task"}
    staff_read = {"coordinator_read", "doctor_read"}
    if action in patient_actions:
        if actor.role != "patient":
            raise ApiError(404, "not_found", "Запись не найдена")
        if actor.patient_id != case["patient_id"] and not _same_verified_phone(conn, actor, case["patient_id"]):
            raise ApiError(404, "not_found", "Запись не найдена")
        return case
    if action in staff_read | {"coordinator_write", "doctor_write"}:
        if action == "coordinator_write" and not is_coordinator(actor):
            raise ApiError(403, "forbidden", "Это действие доступно координатору")
        if action == "doctor_write" and not is_doctor(actor):
            raise ApiError(403, "forbidden", "Это действие доступно только врачу")
        if action in staff_read and actor.role not in STAFF_ROLES:
            raise ApiError(403, "forbidden", "Недостаточно прав")
        if action == "doctor_read" and not is_doctor(actor):
            raise ApiError(403, "forbidden", "Медицинский контекст доступен врачу")
        return case
    raise ApiError(403, "forbidden", "Действие не разрешено")
