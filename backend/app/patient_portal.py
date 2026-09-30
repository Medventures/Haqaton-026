"""Demo patient portal: phone + fixed demo code login, profile and cases for the cabinet.

Login = phone + one-time SMS code (app/otp.py: hashed codes, TTL, attempt and resend
limits, pluggable SMS provider). In demo mode the provider only logs and the code is 0000.
Open for production: real SMS provider credentials, session expiry/rotation, IP rate limits.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.consent import project_case
from app.db import DATA, audit, connect, new_id
from app.errors import ApiError
from app.sessions import current_actor, demo_enabled, normalize_phone
from app.staff_reads import next_action_for

router = APIRouter()

DEMO_CODE = "0000"
# Test/presentation number: logs straight into the clinic workspace as the admin account.
ADMIN_PHONE = "+77777777777"
COOKIE = "prime_owner"

# Patient-facing journey order; stage → index of the current step.
JOURNEY_STEPS = [
    "intake",
    "programme",
    "therapist",
    "physician_plan",
    "preparation",
    "results",
    "follow_up",
]
STAGE_STEP = {
    "questionnaire_saved": 1,
    "package_selected": 2,
    "therapist_booking_requested": 2,
    "therapist_booking_confirmed": 2,
    "consultation_completed": 3,
    "physician_plan_confirmed": 4,
    "preparation_in_progress": 4,
    "results_available": 5,
    "follow_up_planned": 6,
}


class LoginBody(BaseModel):
    phone: str = Field(min_length=5, max_length=32)
    code: str = Field(min_length=1, max_length=8)


def _catalogue_names() -> dict[str, str]:
    path = DATA / "catalogue.real.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {p["package_id"]: p["name"] for p in data.get("packages") or []}


def _require_demo() -> None:
    if not demo_enabled():
        raise ApiError(404, "not_found", "Не найдено")


def _complete_login(phone: str, response: Response, mode: str) -> dict:
    """Issue a verified session for a phone that proved ownership (OTP or demo code)."""
    if phone == ADMIN_PHONE:
        with connect() as conn:
            row = conn.execute("SELECT token, display_name FROM staff_sessions WHERE token = 'demo-admin'").fetchone()
            audit(conn, None, "demo-admin", "admin_login", {"mode": mode})
            conn.commit()
        if row is None:
            raise ApiError(404, "not_found", "Администратор не найден")
        return {"role": "admin", "token": row["token"], "patient_id": None, "display_name": row["display_name"], "language": "ru", "is_demo": True}

    with connect() as conn:
        # Stored phones may be formatted differently; compare normalized values.
        rows = conn.execute("SELECT id, display_name, contact_name, language, phone FROM patients ORDER BY rowid").fetchall()
        matches = [r for r in rows if normalize_phone(r["phone"]) == phone]
        if not matches:
            raise ApiError(404, "patient_not_found", "Пациент с таким номером не найден", {"phone": "not_found"})
        row = matches[0]
        # Fresh verified session: sees every case booked under this phone.
        token = new_id("login")
        conn.execute("INSERT INTO owner_sessions (token, patient_id, created_at) VALUES (?,?,datetime('now'))", (token, row["id"]))
        conn.execute("INSERT INTO patient_logins (token, phone, created_at) VALUES (?,?,datetime('now'))", (token, phone))
        audit(conn, None, row["id"], "patient_login", {"mode": mode})
        conn.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax")
    return {
        "role": "patient",
        "token": token,
        "patient_id": row["id"],
        "display_name": row["contact_name"] or row["display_name"],
        "language": row["language"],
        "is_demo": True,
    }


@router.post("/api/patient/login")
def patient_login(body: LoginBody, response: Response) -> dict:
    """Legacy demo shortcut (fixed code, no SMS). Kept for tests; the UI uses /otp/*."""
    _require_demo()
    phone = normalize_phone(body.phone)
    if phone is None:
        raise ApiError(422, "phone_invalid", "Проверьте номер телефона", {"phone": "invalid"})
    if body.code.strip() != DEMO_CODE:
        raise ApiError(401, "code_invalid", "Неверный код", {"code": "invalid"})
    return _complete_login(phone, response, "demo")


class OtpRequestBody(BaseModel):
    phone: str = Field(min_length=5, max_length=32)


@router.post("/api/patient/otp/request")
def otp_request(body: OtpRequestBody) -> dict:
    """Send a one-time code by SMS. Same answer for known and unknown numbers (no enumeration)."""
    from app.otp import request_code

    phone = normalize_phone(body.phone)
    if phone is None:
        raise ApiError(422, "phone_invalid", "Проверьте номер телефона", {"phone": "invalid"})
    with connect() as conn:
        result = request_code(conn, phone)
        conn.commit()
    return result


@router.post("/api/patient/otp/verify")
def otp_verify(body: LoginBody, response: Response) -> dict:
    from app.otp import verify_code

    phone = normalize_phone(body.phone)
    if phone is None:
        raise ApiError(422, "phone_invalid", "Проверьте номер телефона", {"phone": "invalid"})
    with connect() as conn:
        verify_code(conn, phone, body.code.strip())
        conn.commit()
    return _complete_login(phone, response, "otp")


@router.post("/api/patient/logout")
def patient_logout(response: Response) -> dict:
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/api/patient/me")
def patient_me(request: Request) -> dict:
    _require_demo()
    with connect() as conn:
        actor = current_actor(conn, request)
        if actor.role != "patient" or not actor.patient_id:
            raise ApiError(401, "session_required", "Нужно войти в кабинет")
        patient = conn.execute("SELECT * FROM patients WHERE id = ?", (actor.patient_id,)).fetchone()
        if patient is None:
            raise ApiError(401, "session_required", "Нужно войти в кабинет")
        names = _catalogue_names()
        patient_ids = [actor.patient_id]
        if actor.verified_phone:
            patient_ids = [
                r["id"]
                for r in conn.execute("SELECT id, phone FROM patients").fetchall()
                if normalize_phone(r["phone"]) == actor.verified_phone
            ] or [actor.patient_id]
        marks = ",".join("?" for _ in patient_ids)
        cases = conn.execute(
            f"SELECT * FROM cases WHERE patient_id IN ({marks}) ORDER BY created_at, id",
            patient_ids,
        ).fetchall()
        items = []
        for case in cases:
            projected = project_case(conn, case, "coordinator")
            program_id = projected["selected_program_id"]
            items.append(
                {
                    "case_id": projected["case_id"],
                    "stage": projected["stage"],
                    "step_index": STAGE_STEP.get(projected["stage"], 0),
                    "selected_program_id": program_id,
                    "selected_program_name": names.get(program_id) if program_id else None,
                    "consultation_reason": projected["consultation_reason"],
                    "preferred_date": projected["preferred_date"],
                    "booked_starts_at": projected["booked_starts_at"],
                    "appointment_status": projected["appointment_status"],
                    "next_action": next_action_for(projected["stage"]),
                    "is_demo": True,
                }
            )
        return {
            "patient_id": patient["id"],
            "display_name": patient["contact_name"] or patient["display_name"],
            "phone": patient["phone"],
            "language": patient["language"],
            "journey_steps": JOURNEY_STEPS,
            "cases": items,
            "is_demo": True,
        }
