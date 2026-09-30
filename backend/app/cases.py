from __future__ import annotations

import json

from fastapi import APIRouter, Request, Response

from app.consent import PROCESSING_TEXT, REMINDER_TEXT, TRANSFER_TEXT, has_granted, record_consent
from app.contracts import CONTRACT_VERSION, CreateCaseBody
from app.db import connect, new_id
from app.errors import ApiError
from app.intake import validate_submission
from app.sessions import current_actor, normalize_phone

router = APIRouter()


@router.post("/api/cases")
def create_case(body: CreateCaseBody, request: Request, response: Response) -> dict:
    if not body.processing_consent.granted or body.processing_consent.text_version != PROCESSING_TEXT:
        raise ApiError(422, "consent_required", "Нужно согласие на обработку ответов")
    if not body.clinic_transfer.granted or body.clinic_transfer.text_version != TRANSFER_TEXT:
        raise ApiError(422, "transfer_required", "Для записи нужно отдельное согласие на передачу в клинику")
    if not body.contact_name.strip() or not body.phone.strip():
        raise ApiError(422, "contact_required", "Укажите имя и телефон", {"phone": "required"})
    phone = normalize_phone(body.phone)
    if phone is None:
        raise ApiError(422, "phone_invalid", "Проверьте номер телефона", {"phone": "invalid"})
    active = validate_submission(body)
    case_id = new_id("case")
    revision_id = new_id("rev")
    with connect() as conn:
        # Only an explicit session header (signed-in cabinet) links the booking to that client;
        # a leftover cookie from an earlier anonymous booking does not.
        actor = current_actor(conn, request) if request.headers.get("x-owner-session") else None
        if actor is not None and actor.role == "patient" and actor.patient_id:
            # Signed-in patient books again: new request under the same client and session.
            patient_id, token = actor.patient_id, actor.token
        else:
            patient_id, token = new_id("patient"), new_id("owner")
            conn.execute(
                "INSERT INTO patients (id, display_name, contact_name, phone, language, is_demo) VALUES (?,?,?,?,?,1)",
                (patient_id, body.contact_name.strip(), body.contact_name.strip(), phone, "ru"),
            )
            conn.execute(
                "INSERT INTO owner_sessions (token, patient_id, created_at) VALUES (?,?,datetime('now'))",
                (token, patient_id),
            )
        conn.execute(
            """INSERT INTO cases (
                id, patient_id, stage, current_revision_id, selected_program_id, consultation_reason,
                preferred_date, language, is_demo, created_at
            ) VALUES (?,?,?,?,?,?,?,'ru',1,datetime('now'))""",
            (
                case_id,
                patient_id,
                "questionnaire_saved",
                revision_id,
                body.selected_package_id,
                body.consultation_reason,
                body.preferred_date,
            ),
        )
        conn.execute(
            """INSERT INTO questionnaire_revisions
            (id, case_id, kind, answers_json, doctor_note, active_fields_json, created_at)
            VALUES (?,?,?,?,?,?,datetime('now'))""",
            (
                revision_id,
                case_id,
                "intake",
                json.dumps(active.answers, ensure_ascii=False),
                active.doctor_note,
                json.dumps(active.active_fields, ensure_ascii=False),
            ),
        )
        record_consent(conn, case_id=case_id, scope="processing", text_version=PROCESSING_TEXT, granted=True, actor=patient_id)
        record_consent(conn, case_id=case_id, scope="clinic_transfer", text_version=TRANSFER_TEXT, granted=True, actor=patient_id)
        if body.reminder_opt_in:
            record_consent(conn, case_id=case_id, scope="reminders", text_version=REMINDER_TEXT, granted=True, actor=patient_id)
        transferred = has_granted(conn, case_id, "clinic_transfer")
        conn.commit()
    response.set_cookie("prime_owner", token, httponly=True, samesite="lax")
    return {
        "contract_version": CONTRACT_VERSION,
        "case_id": case_id,
        "patient_id": patient_id,
        "owner_session": token,
        "revision_id": revision_id,
        "state": "questionnaire_saved",
        "is_demo": True,
        "transfer_granted": transferred,
        "analytics_session_id": body.analytics_session_id or request.headers.get("x-analytics-session"),
    }
