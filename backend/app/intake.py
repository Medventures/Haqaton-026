from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from app.conditions import condition_met
from app.consent import PROCESSING_TEXT
from app.contracts import (
    CATALOGUE_VERSION,
    CONTRACT_VERSION,
    QUESTIONNAIRE_VERSION,
    RULES_VERSION,
    ActiveAnswers,
    Preview,
    QuestionnaireSubmission,
)
from app.db import DATA, audit, connect, new_id
from app.errors import ApiError
from app.matching import build_preview
from app.sessions import current_actor, require_case

router = APIRouter()

_QUESTIONNAIRE_CACHE: dict[str, Any] | None = None


def _questionnaire() -> dict[str, Any]:
    global _QUESTIONNAIRE_CACHE
    if _QUESTIONNAIRE_CACHE is None:
        _QUESTIONNAIRE_CACHE = json.loads((DATA / "questionnaire.json").read_text(encoding="utf-8"))
    return _QUESTIONNAIRE_CACHE


def _condition_met(condition: dict[str, Any] | None, answers: dict[str, Any]) -> bool:
    return condition_met(condition, answers)


def _is_visible(question: dict[str, Any], answers: dict[str, Any]) -> bool:
    show_if = question.get("show_if")
    if show_if is None:
        return True
    return _condition_met(show_if, answers)


def _is_required(question: dict[str, Any], answers: dict[str, Any], visible: bool) -> bool:
    if not visible:
        return False
    if question.get("required"):
        return True
    required_if = question.get("required_if")
    if required_if is not None:
        return _condition_met(required_if, answers)
    return False


def _option_codes(question: dict[str, Any]) -> set[str]:
    return {opt["code"] for opt in question.get("options") or []}


def _validate_answer(question: dict[str, Any], value: Any, field_errors: dict[str, str]) -> None:
    qid = question["id"]
    answer_type = question["answer_type"]
    if answer_type == "number":
        if not isinstance(value, int) or isinstance(value, bool):
            field_errors[qid] = "must_be_integer"
            return
        rules = question.get("validation") or {}
        minimum = rules.get("min")
        maximum = rules.get("max")
        if minimum is not None and value < minimum:
            field_errors[qid] = "below_min"
        if maximum is not None and value > maximum:
            field_errors[qid] = "above_max"
        return
    codes = _option_codes(question)
    if answer_type == "single":
        if not isinstance(value, str) or value not in codes:
            field_errors[qid] = "invalid_option"
        return
    if answer_type == "multi":
        if not isinstance(value, list) or not value or any(not isinstance(item, str) for item in value):
            field_errors[qid] = "invalid_multi"
            return
        if len(set(value)) != len(value):
            field_errors[qid] = "duplicate_options"
            return
        if any(item not in codes for item in value):
            field_errors[qid] = "invalid_option"
            return
        exclusive = set(question.get("exclusive") or [])
        selected = set(value)
        exclusive_hits = selected & exclusive
        positive = selected - exclusive
        if exclusive_hits and positive:
            field_errors[qid] = "exclusive_conflict"
            return
        if len(exclusive_hits) > 1:
            field_errors[qid] = "exclusive_conflict"


def validate_submission(body: QuestionnaireSubmission) -> ActiveAnswers:
    if body.questionnaire_version != QUESTIONNAIRE_VERSION:
        raise ApiError(422, "questionnaire_version_mismatch", "Версия анкеты не поддерживается")
    if body.doctor_note is not None and len(body.doctor_note) > 200:
        raise ApiError(
            422,
            "validation_error",
            "Заметка слишком длинная",
            {"doctor_note": "max_length"},
        )

    config = _questionnaire()
    answers = body.answers or {}
    if not isinstance(answers, dict):
        raise ApiError(422, "validation_error", "Ответы должны быть объектом", {"answers": "invalid"})

    field_errors: dict[str, str] = {}
    active_fields: list[str] = []
    active_answers: dict[str, Any] = {}

    for question in config["questions"]:
        qid = question["id"]
        visible = _is_visible(question, answers)
        if not visible:
            continue
        active_fields.append(qid)
        if qid not in answers:
            if _is_required(question, answers, visible):
                field_errors[qid] = "required"
            continue
        value = answers[qid]
        _validate_answer(question, value, field_errors)
        if qid not in field_errors:
            active_answers[qid] = value

    if field_errors:
        raise ApiError(422, "validation_error", "Проверьте ответы анкеты", field_errors)

    return ActiveAnswers(
        answers=active_answers,
        active_fields=active_fields,
        doctor_note=body.doctor_note,
        questionnaire_version=body.questionnaire_version,
        revision_id=body.revision_id,
    )


def _require_processing_consent(body: QuestionnaireSubmission) -> None:
    if not body.processing_consent.granted or body.processing_consent.text_version != PROCESSING_TEXT:
        raise ApiError(422, "consent_required", "Нужно согласие на обработку ответов")


def _preview_from_active(active: ActiveAnswers, *, mode: str, state: str) -> Preview:
    return build_preview(active, mode=mode, state=state)


@router.post("/api/preview", response_model=Preview)
def preview(body: QuestionnaireSubmission) -> Preview:
    _require_processing_consent(body)
    active = validate_submission(body)
    return _preview_from_active(active, mode="anonymous", state="anonymous_preview")


@router.put("/api/cases/{case_id}/questionnaire")
def save_questionnaire(case_id: str, body: QuestionnaireSubmission, request: Request) -> dict:
    _require_processing_consent(body)
    active = validate_submission(body)
    revision_id = new_id("rev")
    with connect() as conn:
        actor = current_actor(conn, request)
        case = require_case(conn, actor, case_id, "patient_read")
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
        conn.execute(
            "UPDATE cases SET current_revision_id = ?, stage = ? WHERE id = ?",
            (revision_id, "questionnaire_saved", case_id),
        )
        audit(
            conn,
            case_id,
            actor.patient_id or actor.token or "patient",
            "questionnaire_saved",
            {"revision_id": revision_id, "previous_revision_id": case["current_revision_id"]},
        )
        conn.commit()
    return {
        "contract_version": CONTRACT_VERSION,
        "case_id": case_id,
        "revision_id": revision_id,
        "state": "questionnaire_saved",
        "active_fields": active.active_fields,
        "is_demo": True,
        "questionnaire_version": QUESTIONNAIRE_VERSION,
        "catalogue_version": CATALOGUE_VERSION,
        "rules_version": RULES_VERSION,
    }


@router.put("/api/cases/{case_id}/previsit")
def save_previsit(case_id: str, body: QuestionnaireSubmission, request: Request) -> dict:
    _require_processing_consent(body)
    if body.questionnaire_version != QUESTIONNAIRE_VERSION:
        raise ApiError(422, "questionnaire_version_mismatch", "Версия анкеты не поддерживается")
    if body.doctor_note is not None and len(body.doctor_note) > 200:
        raise ApiError(422, "validation_error", "Заметка слишком длинная", {"doctor_note": "max_length"})

    config = _questionnaire()
    raw = body.answers or {}
    if not isinstance(raw, dict):
        raise ApiError(422, "validation_error", "Ответы должны быть объектом", {"answers": "invalid"})

    field_errors: dict[str, str] = {}
    active_fields: list[str] = []
    active_answers: dict[str, Any] = {}
    for question in config["questions"]:
        qid = question["id"]
        if qid not in raw:
            # Missing previsit answers stay absent — not coerced to negative/no.
            continue
        visible = _is_visible(question, raw)
        if not visible:
            continue
        active_fields.append(qid)
        _validate_answer(question, raw[qid], field_errors)
        if qid not in field_errors:
            active_answers[qid] = raw[qid]
    if field_errors:
        raise ApiError(422, "validation_error", "Проверьте ответы previsit", field_errors)

    revision_id = new_id("rev")
    with connect() as conn:
        actor = current_actor(conn, request)
        require_case(conn, actor, case_id, "patient_read")
        conn.execute(
            """INSERT INTO questionnaire_revisions
            (id, case_id, kind, answers_json, doctor_note, active_fields_json, created_at)
            VALUES (?,?,?,?,?,?,datetime('now'))""",
            (
                revision_id,
                case_id,
                "previsit",
                json.dumps(active_answers, ensure_ascii=False),
                body.doctor_note,
                json.dumps(active_fields, ensure_ascii=False),
            ),
        )
        audit(
            conn,
            case_id,
            actor.patient_id or actor.token or "patient",
            "previsit_saved",
            {"revision_id": revision_id},
        )
        conn.commit()
    return {
        "contract_version": CONTRACT_VERSION,
        "case_id": case_id,
        "revision_id": revision_id,
        "kind": "previsit",
        "state": "previsit_saved",
        "active_fields": active_fields,
        "is_demo": True,
        "questionnaire_version": QUESTIONNAIRE_VERSION,
    }
