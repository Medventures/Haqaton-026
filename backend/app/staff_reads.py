from __future__ import annotations
import json

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


# --------------------------------------------------------------------------- database view
_DB_CACHE: dict | None = None


def _db_refs() -> dict:
    """Catalogue names/prices and questionnaire option labels for the table view."""
    global _DB_CACHE
    if _DB_CACHE is None:
        from app.db import DATA

        cat = json.loads((DATA / "catalogue.real.json").read_text(encoding="utf-8"))
        q = json.loads((DATA / "questionnaire.json").read_text(encoding="utf-8"))
        _DB_CACHE = {
            "programs": {p["package_id"]: (p["name"], p.get("price_minor")) for p in cat["packages"]},
            "labels": {x["id"]: {o["code"]: o["label"] for o in x.get("options") or []} for x in q["questions"]},
        }
    return _DB_CACHE


@router.get("/api/staff/database")
def staff_database(request: Request) -> dict:
    """One row per request (case) with organisational columns for every staff role.
    Questionnaire-derived columns (age, sex, goal, factors) only for doctor/admin."""
    from app.rules import classify
    from app.tiers import build_offer, fired_rules

    with connect() as conn:
        actor = require_staff(conn, request)
        medical = is_doctor(actor)
        refs = _db_refs()
        rows = conn.execute(
            """SELECT c.*, p.display_name, p.phone, p.language AS p_language, r.answers_json,
                      a.status AS appt_status, s.starts_at AS appt_starts
               FROM cases c
               JOIN patients p ON p.id = c.patient_id
               LEFT JOIN questionnaire_revisions r ON r.id = c.current_revision_id
               LEFT JOIN appointments a ON a.case_id = c.id AND a.status != 'cancelled'
               LEFT JOIN slots s ON s.id = a.slot_id
               ORDER BY c.created_at DESC, c.id"""
        ).fetchall()
        out = []
        for row in rows:
            name, price = refs["programs"].get(row["selected_program_id"] or "", (None, None))
            item = {
                "case_id": row["id"],
                "patient_id": row["patient_id"],
                "name": row["display_name"],
                "phone": row["phone"],
                "language": "kz" if (row["p_language"] or "ru") in {"kk", "kz"} else "ru",
                "created_at": row["created_at"],
                "stage": row["stage"],
                "next_action": next_action_for(row["stage"]),
                "program_id": row["selected_program_id"],
                "program": name,
                "price": price,
                "preferred_date": row["preferred_date"],
                "appointment_at": row["appt_starts"],
                "appointment_status": row["appt_status"],
                "owner_id": row["owner_id"],
            }
            if medical and row["answers_json"]:
                answers = json.loads(row["answers_json"])
                labels = refs["labels"]
                try:
                    offer = build_offer(answers, classify(answers))
                    tier = offer.recommended if offer else None
                    factors = [r["title_ru"] for r in fired_rules(answers)][:3]
                except Exception:
                    tier, factors = None, []
                item.update(
                    {
                        "age": answers.get("age_years"),
                        "sex": labels.get("exam_applicability", {}).get(answers.get("exam_applicability"), None),
                        "goal": labels.get("visit_reason", {}).get(answers.get("visit_reason"), None),
                        "recommended": tier,
                        "factors": factors,
                    }
                )
            out.append(item)
        return {"rows": out, "medical_columns": medical, "total": len(out)}
