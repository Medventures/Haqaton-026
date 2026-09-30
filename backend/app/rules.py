from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Request

from app.contracts import (
    CATALOGUE_VERSION,
    CONTRACT_VERSION,
    QUESTIONNAIRE_VERSION,
    RULES_VERSION,
    ActiveAnswers,
    Preview,
    WorkflowClass,
)
from app.db import DATA, audit, connect, new_id
from app.errors import ApiError
from app.sessions import current_actor, require_case

router = APIRouter()

_POLICY_CACHE: dict[str, Any] | None = None

POSITIVE_CONDITION_CODES = {"blood_pressure", "diabetes", "heart", "thyroid", "lungs", "digestive", "kidneys", "other"}


def _policy() -> dict[str, Any]:
    global _POLICY_CACHE
    if _POLICY_CACHE is None:
        _POLICY_CACHE = json.loads((DATA / "demo_policy.json").read_text(encoding="utf-8"))
    return _POLICY_CACHE


@dataclass
class Classification:
    workflow_class: WorkflowClass
    review_flags: list[str] = field(default_factory=list)
    questions_for_doctor: list[str] = field(default_factory=list)
    allow_candidates: bool = True
    force_needs_review: bool = False
    reason_codes: list[str] = field(default_factory=list)


def classify(answers: dict[str, Any]) -> Classification:
    """Demo-only ordered classifier. Not clinical approval."""
    policy = _policy()
    age = answers.get("age_years")
    adult_min = int(policy.get("adult_min_age", 18))
    safety_codes = set(policy.get("safety_stop_symptom_codes") or [])
    boundary_ages = set(policy.get("age_boundary_unresolved") or [])

    if isinstance(age, int) and age < adult_min:
        return Classification(
            workflow_class=WorkflowClass.adult_scope_excluded,
            review_flags=["adult_scope_excluded"],
            questions_for_doctor=["Возраст вне взрослого demo-scope"],
            allow_candidates=False,
            reason_codes=["adult_scope_excluded"],
        )

    symptoms = answers.get("symptoms") or []
    if isinstance(symptoms, list):
        selected_safety = [code for code in symptoms if code in safety_codes]
        if selected_safety:
            return Classification(
                workflow_class=WorkflowClass.safety_stop,
                review_flags=["safety_stop"],
                questions_for_doctor=["Симптомы из safety-stop списка требуют отдельного маршрута"],
                allow_candidates=False,
                reason_codes=["safety_stop"],
            )

    pregnancy = answers.get("pregnancy")
    if pregnancy in {"yes", "unknown"}:
        return Classification(
            workflow_class=WorkflowClass.pregnancy_review,
            review_flags=["pregnancy_review", "policy_unapproved"],
            questions_for_doctor=["Уточнить беременность/вероятность с врачом"],
            allow_candidates=True,
            force_needs_review=True,
            reason_codes=["pregnancy_review"],
        )

    review_flags: list[str] = []
    questions: list[str] = []
    reason_codes: list[str] = []

    if isinstance(age, int) and age in boundary_ages:
        review_flags.append("age_boundary_unresolved")
        questions.append("Граница возраста 40 в demo-каталоге не подтверждена")
        reason_codes.append("age_boundary_unresolved")

    needs_review = False
    if answers.get("visit_reason") == "complaints":
        needs_review = True
        review_flags.append("complaints_present")
        questions.append("Есть жалобы — обсудить с врачом")
        reason_codes.append("complaints_present")

    conditions = answers.get("conditions") or []
    if isinstance(conditions, list) and any(code in POSITIVE_CONDITION_CODES for code in conditions):
        needs_review = True
        review_flags.append("positive_conditions")
        questions.append("Известные заболевания требуют клинического контекста")
        reason_codes.append("positive_conditions")

    if answers.get("medicines") == "yes":
        needs_review = True
        review_flags.append("medicines_yes")
        questions.append("Регулярный приём лекарств — уточнить у врача")
        reason_codes.append("medicines_yes")

    if isinstance(symptoms, list) and "unsure" in symptoms:
        needs_review = True
        review_flags.append("symptoms_unsure")
        questions.append("Неуверенность по симптомам")
        reason_codes.append("symptoms_unsure")

    if isinstance(symptoms, list) and "other" in symptoms:
        needs_review = True
        review_flags.append("symptoms_other")
        questions.append("Отмечены другие симптомы — уточнить на приёме")
        reason_codes.append("symptoms_other")

    if answers.get("exam_applicability") == "discuss":
        needs_review = True
        review_flags.append("applicability_discuss")
        questions.append("Применимость обследований обсудить с врачом")
        reason_codes.append("applicability_discuss")

    if needs_review:
        if "policy_unapproved" not in review_flags:
            review_flags.append("policy_unapproved")
        return Classification(
            workflow_class=WorkflowClass.needs_clinician_review,
            review_flags=review_flags,
            questions_for_doctor=questions,
            allow_candidates=True,
            force_needs_review=True,
            reason_codes=reason_codes,
        )

    # Clean prevention path: policy is unapproved → catalogue_only, not standard_preview.
    if "policy_unapproved" not in review_flags:
        review_flags.append("policy_unapproved")
    return Classification(
        workflow_class=WorkflowClass.catalogue_only,
        review_flags=review_flags,
        questions_for_doctor=questions,
        allow_candidates=True,
        force_needs_review=True,
        reason_codes=reason_codes or ["catalogue_only_unapproved_policy"],
    )


@router.post("/api/cases/{case_id}/recommendations", response_model=Preview)
def recommendations(case_id: str, request: Request) -> Preview:
    from app.matching import build_preview

    with connect() as conn:
        actor = current_actor(conn, request)
        case = require_case(conn, actor, case_id, "patient_read")
        revision_id = case["current_revision_id"]
        if not revision_id:
            raise ApiError(409, "revision_missing", "Нет сохранённой анкеты")
        revision = conn.execute(
            "SELECT * FROM questionnaire_revisions WHERE id = ? AND case_id = ?",
            (revision_id, case_id),
        ).fetchone()
        if revision is None:
            raise ApiError(404, "not_found", "Ревизия не найдена")
        answers = json.loads(revision["answers_json"])
        active_fields = json.loads(revision["active_fields_json"])
        active = ActiveAnswers(
            answers=answers,
            active_fields=active_fields,
            doctor_note=revision["doctor_note"],
            questionnaire_version=QUESTIONNAIRE_VERSION,
            revision_id=revision_id,
        )
        preview = build_preview(active, mode="saved", state="recommendations_ready")
        payload = preview.model_dump(mode="json")
        rec_id = new_id("rec")
        conn.execute(
            """INSERT INTO recommendations (id, case_id, revision_id, payload_json, created_at)
            VALUES (?,?,?,?,datetime('now'))""",
            (rec_id, case_id, revision_id, json.dumps(payload, ensure_ascii=False)),
        )
        conn.execute(
            "UPDATE cases SET stage = ? WHERE id = ?",
            ("recommendations_ready", case_id),
        )
        audit(
            conn,
            case_id,
            actor.patient_id or actor.token or "patient",
            "recommendations_computed",
            {
                "revision_id": revision_id,
                "recommendation_id": rec_id,
                "workflow_class": preview.workflow_class.value,
            },
        )
        conn.commit()
    return preview
