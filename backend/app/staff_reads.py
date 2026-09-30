from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.availability import slot_is_busy, slot_matches_date
from app.consent import project_case
from app.db import audit, connect, transaction
from app.errors import ApiError
from app.sessions import STAFF_ROLES, current_actor, is_doctor, require_case

router = APIRouter()

MEDICAL_PATCH_FIELDS = {
    "answers",
    "questionnaire",
    "doctor_note",
    "selected_program_id",
    "consultation_reason",
    "stage",
    "requested_services",
    "requested_changes",
    "revision_id",
    "appointment_status",
    "current_revision_id",
    "patient_id",
}

STAGE_NEXT_ACTION = {
    "questionnaire_saved": "select_programme",
    "package_selected": "book_therapist",
    "therapist_booking_requested": "await_clinic_confirmation",
    "therapist_booking_confirmed": "await_consultation",
    "consultation_completed": "create_physician_plan",
    "physician_plan_confirmed": "build_route",
    "preparation_in_progress": "complete_preparation",
    "results_available": "review_results",
    "follow_up_planned": "complete_follow_up",
}


def next_action_for(stage: str | None) -> str:
    if not stage:
        return "review_case"
    return STAGE_NEXT_ACTION.get(stage, "review_case")


def enrich_case_row(projected: dict) -> dict:
    projected["next_action"] = next_action_for(projected.get("stage"))
    return projected


def require_staff(conn, request: Request):
    actor = current_actor(conn, request)
    if actor.role not in STAFF_ROLES:
        raise ApiError(403, "forbidden", "Недостаточно прав")
    return actor


@router.get("/api/staff/schedule")
def staff_schedule(request: Request, date: str = Query(...)) -> dict:
    with connect() as conn:
        require_staff(conn, request)
        rows = conn.execute(
            """SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.blocked, s.therapist_id,
                      a.case_id AS case_id, a.status AS appointment_status
               FROM slots s
               LEFT JOIN appointments a
                 ON a.slot_id = s.id AND a.status != 'cancelled'
               ORDER BY s.starts_at"""
        ).fetchall()
        items = []
        for row in rows:
            if not slot_matches_date(row["starts_at"], date):
                continue
            busy = slot_is_busy(conn, row["slot_id"], row["blocked"])
            items.append(
                {
                    "slot_id": row["slot_id"],
                    "therapist_id": row["therapist_id"],
                    "starts_at": row["starts_at"],
                    "ends_at": row["ends_at"],
                    "availability": "busy" if busy else "available",
                    "case_id": row["case_id"],
                    "appointment_status": row["appointment_status"],
                }
            )
        return {"date": date, "items": items, "timezone": "Asia/Almaty", "is_demo": True}


@router.get("/api/staff/patients")
def staff_patients(
    request: Request,
    stage: str | None = None,
    programme: str | None = None,
    preferred_date: str | None = None,
    search: str | None = None,
) -> dict:
    with connect() as conn:
        require_staff(conn, request)
        cases = conn.execute(
            """SELECT c.*, p.display_name, p.contact_name, p.phone
               FROM cases c
               JOIN patients p ON p.id = c.patient_id
               ORDER BY c.created_at, c.id"""
        ).fetchall()
        patients = []
        needle = (search or "").strip().lower()
        for case in cases:
            if stage and case["stage"] != stage:
                continue
            if programme and case["selected_program_id"] != programme:
                continue
            if preferred_date and case["preferred_date"] != preferred_date:
                continue
            if needle:
                hay = " ".join(
                    [
                        case["patient_id"] or "",
                        case["id"] or "",
                        case["display_name"] or "",
                        case["contact_name"] or "",
                        case["phone"] or "",
                    ]
                ).lower()
                if needle not in hay:
                    continue
            projected = project_case(conn, case, "coordinator")
            patients.append(
                {
                    "patient_id": projected["patient_id"],
                    "case_id": projected["case_id"],
                    "display_name": projected["display_name"],
                    "stage": projected["stage"],
                    "selected_program_id": projected["selected_program_id"],
                    "preferred_date": projected["preferred_date"],
                    "booked_starts_at": projected["booked_starts_at"],
                    "appointment_status": projected["appointment_status"],
                    "next_action": next_action_for(projected["stage"]),
                    "is_demo": True,
                }
            )
        return {"patients": patients, "is_demo": True}


@router.get("/api/staff/patients/{patient_id}")
def staff_patient(patient_id: str, request: Request) -> dict:
    with connect() as conn:
        actor = require_staff(conn, request)
        patient = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
        if patient is None:
            raise ApiError(404, "not_found", "Пациент не найден")
        cases = conn.execute(
            "SELECT * FROM cases WHERE patient_id = ? ORDER BY created_at, id",
            (patient_id,),
        ).fetchall()
        role = "doctor" if is_doctor(actor) else "coordinator"
        return {
            "patient_id": patient["id"],
            "display_name": patient["display_name"],
            "contact_name": patient["contact_name"],
            "phone": patient["phone"],
            "language": patient["language"],
            "is_demo": True,
            "cases": [enrich_case_row(project_case(conn, case, role)) for case in cases],
        }


@router.get("/api/staff/cases/{case_id}")
def staff_case(case_id: str, request: Request) -> dict:
    with connect() as conn:
        actor = require_staff(conn, request)
        action = "doctor_read" if is_doctor(actor) else "coordinator_read"
        case = require_case(conn, actor, case_id, action)
        role = "doctor" if is_doctor(actor) else "coordinator"
        return enrich_case_row(project_case(conn, case, role))


@router.patch("/api/staff/cases/{case_id}")
def patch_staff_case(case_id: str, body: dict, request: Request) -> dict:
    if not isinstance(body, dict):
        raise ApiError(422, "validation", "Ожидается JSON-объект")
    medical = sorted(set(body) & MEDICAL_PATCH_FIELDS)
    if medical:
        raise ApiError(
            422,
            "validation",
            "Медицинские поля нельзя менять этим методом",
            {field: "not_allowed" for field in medical},
        )
    unknown = sorted(set(body) - {"notes", "owner_id", "preferred_date"})
    if unknown:
        raise ApiError(
            422,
            "validation",
            "Допустимы только notes, owner_id, preferred_date",
            {field: "not_allowed" for field in unknown},
        )
    if not body:
        raise ApiError(422, "validation", "Нет полей для обновления")

    with transaction() as conn:
        actor = current_actor(conn, request)
        case = require_case(conn, actor, case_id, "coordinator_write")
        fields = []
        values: list = []
        for key in ("notes", "owner_id", "preferred_date"):
            if key in body:
                fields.append(f"{key} = ?")
                values.append(body[key])
        if fields:
            values.append(case_id)
            conn.execute(f"UPDATE cases SET {', '.join(fields)} WHERE id = ?", values)
            audit(conn, case_id, actor.token or actor.role, "case_org_patch", {k: body[k] for k in body})
        updated = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        return enrich_case_row(project_case(conn, updated, "coordinator"))
