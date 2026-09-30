from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request, Response

from app.contracts import CONTRACT_VERSION
from app.db import audit, new_id, transaction
from app.errors import ApiError
from app.plans import load_journey_case
from app.sessions import STAFF_ROLES, Actor, current_actor, require_case

router = APIRouter()

CLINIC_TZ = "Asia/Almaty"
# Deterministic demo day in UTC (matches seed style for Asia/Almaty morning).
FEASIBLE_DAY = datetime(2026, 10, 9, 4, 0, tzinfo=timezone.utc)

PROCEDURE_META = {
    "demo_lab": {"minutes": 20, "resource": "lab-demo", "buffer_after": 20},
    "demo_ultrasound": {"minutes": 30, "resource": "us-demo", "buffer_after": 20},
    "demo_ecg": {"minutes": 15, "resource": "ecg-demo", "buffer_after": 15},
    "demo_final_consult": {"minutes": 30, "resource": "consult-demo", "buffer_after": 0},
    "demo_result_consult": {"minutes": 30, "resource": "consult-demo", "buffer_after": 0},
}

THERAPIST_SERVICE = "therapist_visit"


def _require_case_read(conn, actor: Actor, case_id: str):
    if actor.role == "patient":
        return require_case(conn, actor, case_id, "patient_read")
    if actor.role in STAFF_ROLES:
        return require_case(conn, actor, case_id, "coordinator_read")
    raise ApiError(401, "session_required", "Нужна сессия")


def _plan_row(conn, case_id: str):
    return conn.execute(
        "SELECT * FROM physician_plans WHERE case_id = ? ORDER BY approved_at DESC, id ASC LIMIT 1",
        (case_id,),
    ).fetchone()


def _route_rows(conn, case_id: str):
    return conn.execute(
        "SELECT * FROM route_items WHERE case_id = ? ORDER BY starts_at IS NULL, starts_at, id",
        (case_id,),
    ).fetchall()


def _serialize_item(row) -> dict:
    return {
        "id": row["id"],
        "case_id": row["case_id"],
        "plan_id": row["plan_id"],
        "procedure_code": row["procedure_code"],
        "starts_at": row["starts_at"],
        "ends_at": row["ends_at"],
        "resource": row["resource"],
        "prerequisites": json.loads(row["prerequisites_json"] or "[]"),
        "feasible": bool(row["feasible"]),
        "outcome": row["outcome"],
        "is_demo": bool(row["is_demo"]),
    }


def _route_payload(case_id: str, plan_id: str, items: list) -> dict:
    serialized = [_serialize_item(i) for i in items]
    overall = all(i["feasible"] for i in serialized) if serialized else False
    outcome = "scheduled" if overall else (serialized[0]["outcome"] if serialized else "unresolved")
    return {
        "contract_version": CONTRACT_VERSION,
        "case_id": case_id,
        "plan_id": plan_id,
        "feasible": overall,
        "outcome": outcome,
        "items": serialized,
        "is_demo": True,
        "timezone": CLINIC_TZ,
    }


def _insert_item(
    conn,
    *,
    case_id: str,
    plan_id: str,
    procedure_code: str,
    starts_at: str | None,
    ends_at: str | None,
    resource: str | None,
    prerequisites: list,
    feasible: bool,
    outcome: str,
) -> None:
    conn.execute(
        """INSERT INTO route_items (
            id, case_id, plan_id, procedure_code, starts_at, ends_at, resource,
            prerequisites_json, feasible, outcome, is_demo
        ) VALUES (?,?,?,?,?,?,?,?,?,?,1)""",
        (
            new_id("route"),
            case_id,
            plan_id,
            procedure_code,
            starts_at,
            ends_at,
            resource,
            json.dumps(prerequisites, ensure_ascii=False),
            1 if feasible else 0,
            outcome,
        ),
    )


def _build_feasible(conn, case_id: str, plan_id: str, services: list[str]) -> None:
    cursor = FEASIBLE_DAY
    for code in services:
        if code == THERAPIST_SERVICE:
            continue
        meta = PROCEDURE_META.get(code, {"minutes": 20, "resource": "demo-resource", "buffer_after": 15})
        if code == "demo_final_consult":
            starts = datetime(2026, 10, 13, 5, 0, tzinfo=timezone.utc)
        else:
            starts = cursor
        ends = starts + timedelta(minutes=meta["minutes"])
        _insert_item(
            conn,
            case_id=case_id,
            plan_id=plan_id,
            procedure_code=code,
            starts_at=starts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            ends_at=ends.strftime("%Y-%m-%dT%H:%M:%SZ"),
            resource=meta["resource"],
            prerequisites=["results_ready"] if code == "demo_final_consult" else [],
            feasible=True,
            outcome="scheduled_later" if code == "demo_final_consult" else "scheduled",
        )
        if code != "demo_final_consult":
            cursor = ends + timedelta(minutes=meta["buffer_after"])


def _build_impossible(conn, case_id: str, plan_id: str, services: list[str]) -> None:
    codes = [c for c in services if c != THERAPIST_SERVICE] or ["demo_lab"]
    outcome = (
        "Нельзя собрать день обследований: зависимая процедура требует результат, "
        "который не готов в доступном окне. Нужно действие координатора; "
        "фиктивное расписание не создаётся."
    )
    for code in codes:
        _insert_item(
            conn,
            case_id=case_id,
            plan_id=plan_id,
            procedure_code=code,
            starts_at=None,
            ends_at=None,
            resource=None,
            prerequisites=["prior_result_ready"],
            feasible=False,
            outcome=outcome,
        )


@router.post("/api/cases/{case_id}/route")
def create_route(case_id: str, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        if actor.role == "patient":
            require_case(conn, actor, case_id, "patient_read")
        elif actor.role in STAFF_ROLES:
            require_case(conn, actor, case_id, "coordinator_read")
        else:
            raise ApiError(401, "session_required", "Нужна сессия")

        plan = _plan_row(conn, case_id)
        if plan is None:
            raise ApiError(409, "plan_not_approved", "Сначала врач должен подтвердить демо-план")

        existing = _route_rows(conn, case_id)
        if existing:
            return _route_payload(case_id, plan["id"], existing)

        services = json.loads(plan["services_json"] or "[]")
        journey = load_journey_case(case_id) or {}
        if journey.get("route_outcome") == "impossible":
            _build_impossible(conn, case_id, plan["id"], services)
        else:
            _build_feasible(conn, case_id, plan["id"], services)

        items = _route_rows(conn, case_id)
        audit(
            conn,
            case_id,
            actor.token or actor.role,
            "route_built",
            {"plan_id": plan["id"], "feasible": all(bool(i["feasible"]) for i in items)},
        )
        return _route_payload(case_id, plan["id"], items)


def _ics_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _to_ics_utc(ts: str) -> str | None:
    if not ts:
        return None
    raw = ts.strip()
    if raw.endswith("Z"):
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    else:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


@router.get("/api/cases/{case_id}/calendar.ics")
def calendar_ics(case_id: str, request: Request) -> Response:
    with transaction() as conn:
        actor = current_actor(conn, request)
        _require_case_read(conn, actor, case_id)

        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//PRIME Check-up demo//EN",
            f"X-WR-TIMEZONE:{CLINIC_TZ}",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
        ]

        appts = conn.execute(
            """SELECT a.id, a.status, s.starts_at, s.ends_at
            FROM appointments a
            JOIN slots s ON s.id = a.slot_id
            WHERE a.case_id = ? AND a.status IN ('demo_confirmed', 'clinic_confirmed')""",
            (case_id,),
        ).fetchall()
        for appt in appts:
            start = _to_ics_utc(appt["starts_at"])
            end = _to_ics_utc(appt["ends_at"])
            if not start or not end:
                continue
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{appt['id']}@prime-demo",
                    f"DTSTART:{start}",
                    f"DTEND:{end}",
                    f"SUMMARY:{_ics_escape('Приём терапевта (demo)')}",
                    f"DESCRIPTION:{_ics_escape('Подтверждённая запись. Часовой пояс клиники: ' + CLINIC_TZ)}",
                    "END:VEVENT",
                ]
            )

        for item in _route_rows(conn, case_id):
            if not item["feasible"]:
                continue
            start = _to_ics_utc(item["starts_at"])
            end = _to_ics_utc(item["ends_at"])
            if not start or not end:
                continue
            summary = f"Обследование: {item['procedure_code']} (demo)"
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{item['id']}@prime-demo",
                    f"DTSTART:{start}",
                    f"DTEND:{end}",
                    f"SUMMARY:{_ics_escape(summary)}",
                    f"DESCRIPTION:{_ics_escape(item['outcome'] or 'scheduled')}",
                    "END:VEVENT",
                ]
            )

        lines.append("END:VCALENDAR")
        body = "\r\n".join(lines) + "\r\n"
        return Response(
            content=body,
            media_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{case_id}.ics"'},
        )
