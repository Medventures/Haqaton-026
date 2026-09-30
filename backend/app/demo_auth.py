from __future__ import annotations

from fastapi import APIRouter, Response

from app.contracts import DemoSessionBody
from app.db import connect
from app.errors import ApiError
from app.sessions import demo_enabled

router = APIRouter()


@router.post("/api/demo/session")
def open_demo_session(body: DemoSessionBody, response: Response) -> dict:
    if not demo_enabled():
        raise ApiError(404, "not_found", "Не найдено")
    with connect() as conn:
        if body.role == "admin":
            row = conn.execute("SELECT token, role, display_name FROM staff_sessions WHERE token = 'demo-admin'").fetchone()
        elif body.role == "doctor":
            row = conn.execute("SELECT token, role, display_name FROM staff_sessions WHERE token = 'demo-doctor'").fetchone()
        elif body.role == "coordinator":
            row = conn.execute(
                "SELECT token, role, display_name FROM staff_sessions WHERE token = 'demo-coordinator'"
            ).fetchone()
        else:
            if not body.patient_id:
                raise ApiError(422, "patient_required", "Для пациента нужен patient_id")
            row = conn.execute(
                """SELECT s.token AS token, 'patient' AS role, p.display_name AS display_name
                FROM owner_sessions s JOIN patients p ON p.id = s.patient_id
                WHERE s.patient_id = ?""",
                (body.patient_id,),
            ).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "Демо-сессия не найдена")
        token = row["token"]
        payload = {"token": token, "role": row["role"], "display_name": row["display_name"], "is_demo": True}
    response.set_cookie("prime_owner", token, httponly=True, samesite="lax")
    return payload
