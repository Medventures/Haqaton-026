from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from app.contracts import (
    CATALOGUE_VERSION,
    CONTRACT_VERSION,
    QUESTIONNAIRE_VERSION,
    RULES_VERSION,
    ActiveAnswers,
    Eligibility,
    PackageCandidate,
    Preview,
    Reason,
    SelectionBody,
    WorkflowClass,
)
from app.db import DATA, audit, connect, new_id
from app.errors import ApiError
from app.rules import Classification, classify
from app.sessions import current_actor, require_case

router = APIRouter()

_CATALOGUE_CACHE: dict[str, Any] | None = None
_REASON_COPY_CACHE: dict[str, dict[str, str]] | None = None

_COMPOSITION_API = {
    "complete": "complete",
    "incomplete": "incomplete",
    "unknown": "unknown",
    # Catalogue stores honest "partial"; contract only allows incomplete/unknown/complete.
    "partial": "incomplete",
}

_NEED_REASON_BY_BLOCK = {
    "cardio": "need_cardio",
    "lung_ct": "need_lung_ct",
    "endoscopy": "need_endoscopy",
    "labs": "need_labs",
    "gyn": "need_gyn",
    "prostate": "need_prostate",
    "ultrasound": "need_ultrasound",
}


def _catalogue() -> dict[str, Any]:
    global _CATALOGUE_CACHE
    if _CATALOGUE_CACHE is None:
        path = DATA / "catalogue.real.json"
        if not path.exists():
            path = DATA / "catalogue.json"
        _CATALOGUE_CACHE = json.loads(path.read_text(encoding="utf-8"))
    return _CATALOGUE_CACHE


def _reason_copy() -> dict[str, dict[str, str]]:
    global _REASON_COPY_CACHE
    if _REASON_COPY_CACHE is None:
        path = DATA / "reason_copy.json"
        if path.exists():
            _REASON_COPY_CACHE = json.loads(path.read_text(encoding="utf-8"))
        else:
            _REASON_COPY_CACHE = {}
    return _REASON_COPY_CACHE


def _compose_reason(
    code: str,
    *,
    input_refs: list[str],
    source_refs: list[str],
    template_id: str | None = None,
) -> Reason:
    copy = _reason_copy().get(code) or {}
    return Reason(
        code=code,
        input_refs=input_refs,
        template_id=template_id or code,
        source_refs=source_refs,
        rule_id=code,
        rule_version=RULES_VERSION,
        text_ru=copy.get("text_ru"),
        text_kz=copy.get("text_kz"),
    )


def derive_needs(answers: dict[str, Any]) -> list[str] | None:
    """
    Map questionnaire answers to catalogue block ids for ranking and reasons only.
    Empty list means no block-level needs were derived (coverage stays null, not 100%).
    Medicines and discuss-flags are not turned into new tests.
    """
    needs: list[str] = []
    seen: set[str] = set()

    def add(block_id: str) -> None:
        if block_id not in seen:
            seen.add(block_id)
            needs.append(block_id)

    complaint = answers.get("complaint_topic")
    if complaint == "heart":
        add("cardio")
    elif complaint == "breathing":
        add("lung_ct")
    elif complaint == "digestion":
        add("endoscopy")
    elif complaint == "urinary":
        exam = answers.get("exam_applicability")
        if exam == "female":
            add("gyn")
        elif exam == "male":
            add("prostate")
        else:
            add("gyn")
            add("prostate")
    elif complaint == "general":
        add("labs")

    conditions = answers.get("conditions") or []
    if isinstance(conditions, list):
        if any(code in {"blood_pressure", "heart"} for code in conditions):
            add("cardio")
        if "diabetes" in conditions or "thyroid" in conditions:
            add("labs")
        if "lungs" in conditions:
            add("lung_ct")
        if "digestive" in conditions:
            add("endoscopy")
        if "kidneys" in conditions:
            add("ultrasound")

    tobacco = answers.get("tobacco")
    if tobacco in {"current_cigarettes", "vape", "other_tobacco"}:
        add("lung_ct")

    # medicines → discuss flag in classifier only, not a new test block
    return needs


def _block_ids(package: dict[str, Any]) -> set[str]:
    blocks = package.get("blocks") or []
    if blocks:
        return {b["id"] for b in blocks if isinstance(b, dict) and b.get("id")}
    return set(package.get("known_services") or [])


def _service_set(package: dict[str, Any]) -> set[str]:
    return _block_ids(package)


def _package_age_ok(package: dict[str, Any], age: Any) -> bool:
    branch = package.get("age_branch")
    if not branch:
        return True
    if not isinstance(age, int):
        return branch != "kids"
    if age < 18:
        return branch == "kids"
    if age == 40:
        return branch in {"u40", "40p"}
    if 18 <= age <= 39:
        return branch == "u40"
    if age >= 41:
        return branch == "40p"
    return False


def _package_applicable(package: dict[str, Any], answers: dict[str, Any]) -> bool:
    if not _package_age_ok(package, answers.get("age_years")):
        return False

    applicability = package.get("applicability") or []
    exam = answers.get("exam_applicability")
    if not applicability:
        return True
    if exam is None:
        return True
    # discuss: show both sexes; do not default to male-only.
    if exam == "discuss":
        return "female" in applicability or "male" in applicability or "discuss" in applicability
    return exam in applicability


def _age_reason_code(package: dict[str, Any], age: Any) -> str | None:
    branch = package.get("age_branch")
    if branch == "kids":
        return "age_kids"
    if isinstance(age, int) and age == 40:
        return "age_boundary_unresolved"
    if branch == "u40":
        return "age_u40_basic"
    if branch == "40p":
        return "age_40p_extended"
    return None


def _sex_reason_code(answers: dict[str, Any]) -> str | None:
    exam = answers.get("exam_applicability")
    if exam == "female":
        return "sex_female"
    if exam == "male":
        return "sex_male"
    if exam == "discuss":
        return "sex_discuss"
    return None


def match_packages(
    answers: dict[str, Any],
    classification: Classification,
) -> list[PackageCandidate]:
    if not classification.allow_candidates:
        return []

    # Safety stop / pregnancy review must not auto-pick a "standard" eligible package.
    # Candidates may still be listed for discussion with needs_review.
    catalogue = _catalogue()
    needs = derive_needs(answers)
    needs_set = set(needs or [])
    d_complete = needs is not None
    empty_d = d_complete and len(needs_set) == 0
    catalogue_file = "catalogue.real.json"
    age = answers.get("age_years")

    candidates: list[PackageCandidate] = []
    for package in catalogue.get("packages") or []:
        if not _package_applicable(package, answers):
            continue

        raw_composition = package.get("composition_status") or "unknown"
        composition = _COMPOSITION_API.get(raw_composition, "unknown")
        services = list(package.get("known_services") or [])
        if not services and package.get("blocks"):
            services = [b.get("label") or b.get("id") for b in package["blocks"] if isinstance(b, dict)]
        service_set = _service_set(package)
        missing_positions = list(package.get("missing_positions") or [])
        unknown_positions = list(package.get("unknown_positions") or [])

        if empty_d or not d_complete:
            covered: set[str] = set()
            missing_needs: set[str] = set()
            extra = set(service_set)
            coverage = None
        else:
            covered = needs_set & service_set
            missing_needs = needs_set - service_set
            extra = service_set - needs_set
            coverage = (len(covered) / len(needs_set)) if needs_set else None
        _ = coverage  # intentionally not exposed as health score
        _ = extra

        eligibility = Eligibility.needs_review if classification.force_needs_review else Eligibility.eligible
        if classification.workflow_class in {
            WorkflowClass.pregnancy_review,
            WorkflowClass.safety_stop,
        }:
            eligibility = Eligibility.needs_review
        if composition == "unknown" and not classification.force_needs_review:
            eligibility = Eligibility.needs_review
        if isinstance(age, int) and age == 40:
            eligibility = Eligibility.needs_review

        review_flags = list(classification.review_flags)
        if catalogue.get("approval_status") == "unapproved" and "policy_unapproved" not in review_flags:
            review_flags.append("policy_unapproved")
        if empty_d:
            review_flags.append("needs_unverified")
        if raw_composition == "partial" and "composition_partial" not in review_flags:
            review_flags.append("composition_partial")

        input_refs = sorted(
            {
                f"answers.{key}"
                for key in (
                    "age_years",
                    "visit_reason",
                    "symptoms",
                    "complaint_topic",
                    "pregnancy",
                    "conditions",
                    "medicines",
                    "tobacco",
                    "exam_applicability",
                )
                if key in answers
            }
        )
        source_refs = [catalogue_file]
        pkg_source = package.get("source_url")
        if pkg_source:
            source_refs.append(pkg_source)

        reasons: list[Reason] = []
        age_code = _age_reason_code(package, age)
        if age_code:
            reasons.append(
                _compose_reason(
                    age_code,
                    input_refs=[r for r in input_refs if r.endswith("age_years")] or ["answers.age_years"],
                    source_refs=source_refs,
                )
            )
        sex_code = _sex_reason_code(answers)
        if sex_code:
            reasons.append(
                _compose_reason(
                    sex_code,
                    input_refs=[r for r in input_refs if r.endswith("exam_applicability")]
                    or ["answers.exam_applicability"],
                    source_refs=source_refs,
                )
            )

        for code in classification.reason_codes:
            if code in {age_code, sex_code}:
                continue
            if any(r.code == code for r in reasons):
                continue
            reasons.append(
                _compose_reason(
                    code,
                    input_refs=input_refs or ["answers.age_years"],
                    source_refs=source_refs + ["demo_policy.json", "reason_copy.json"],
                )
            )

        if not classification.reason_codes and not reasons:
            reasons.append(
                _compose_reason(
                    "catalogue_match",
                    input_refs=input_refs or ["answers.age_years"],
                    source_refs=source_refs,
                )
            )

        for block_id in covered:
            need_code = _NEED_REASON_BY_BLOCK.get(block_id)
            if need_code and not any(r.code == need_code for r in reasons):
                refs = [r for r in input_refs if r.split(".", 1)[-1] in {
                    "complaint_topic",
                    "conditions",
                    "tobacco",
                    "visit_reason",
                }]
                reasons.append(
                    _compose_reason(
                        need_code,
                        input_refs=refs or input_refs or ["answers.visit_reason"],
                        source_refs=source_refs + ["reason_copy.json"],
                    )
                )

        if answers.get("medicines") == "yes" and not any(r.code == "medicines_discuss" for r in reasons):
            reasons.append(
                _compose_reason(
                    "medicines_discuss",
                    input_refs=["answers.medicines"],
                    source_refs=source_refs + ["reason_copy.json"],
                )
            )

        if empty_d:
            reasons.append(
                _compose_reason(
                    "empty_needs",
                    input_refs=input_refs or ["answers.visit_reason"],
                    source_refs=source_refs + ["reason_copy.json"],
                )
            )

        if raw_composition == "partial" and not any(r.code == "composition_partial" for r in reasons):
            reasons.append(
                _compose_reason(
                    "composition_partial",
                    input_refs=input_refs or ["answers.age_years"],
                    source_refs=source_refs,
                )
            )

        price_minor = package.get("price_minor", None)
        if price_minor is not None and not isinstance(price_minor, int):
            price_minor = None

        candidates.append(
            PackageCandidate(
                package_id=package["package_id"],
                name=package["name"],
                composition_status=composition,  # type: ignore[arg-type]
                known_services=services,
                missing_positions=missing_positions + sorted(missing_needs),
                unknown_positions=unknown_positions,
                price_minor=price_minor,
                currency=package.get("currency"),
                reasons=reasons,
                eligibility=eligibility,
                review_flags=review_flags,
            )
        )

    # Rank clinic packages only: fewer missing needs, then fewer extra blocks, then stable id.
    # Never assemble a custom package.
    recommended = [c for c in candidates if c.eligibility != Eligibility.ineligible]

    def sort_key(candidate: PackageCandidate) -> tuple[int, int, str]:
        pkg = next(p for p in catalogue["packages"] if p["package_id"] == candidate.package_id)
        service_set = _service_set(pkg)
        if empty_d or not d_complete:
            missing_count = 0
            extra_count = len(service_set)
        else:
            missing_count = len(needs_set - service_set)
            extra_count = len(service_set - needs_set)
        return (missing_count, extra_count, candidate.package_id)

    recommended.sort(key=sort_key)
    return recommended


def build_preview(active: ActiveAnswers, *, mode: str, state: str) -> Preview:
    from app.tiers import build_offer, explanations

    classification = classify(active.answers)
    candidates = match_packages(active.answers, classification)
    return Preview(
        contract_version=CONTRACT_VERSION,
        revision_id=active.revision_id,
        mode=mode,  # type: ignore[arg-type]
        workflow_class=classification.workflow_class,
        candidates=candidates,
        offer=build_offer(active.answers, classification),
        explanations=explanations(active.answers),
        review_flags=classification.review_flags,
        questions_for_doctor=classification.questions_for_doctor,
        is_demo=True,
        questionnaire_version=QUESTIONNAIRE_VERSION,
        catalogue_version=CATALOGUE_VERSION,
        rules_version=RULES_VERSION,
        state=state,
    )


@router.put("/api/cases/{case_id}/selection")
def save_selection(case_id: str, body: SelectionBody, request: Request) -> dict:
    with connect() as conn:
        actor = current_actor(conn, request)
        case = require_case(conn, actor, case_id, "patient_read")
        current = case["current_revision_id"]
        if body.revision_id != current:
            raise ApiError(409, "stale_revision", "Ревизия устарела", {"revision_id": "stale"})

        catalogue = _catalogue()
        package_ids = {p["package_id"] for p in catalogue.get("packages") or []}
        if body.package_id not in package_ids:
            raise ApiError(422, "unknown_package", "Пакет не найден", {"package_id": "unknown"})

        conn.execute(
            """UPDATE cases SET
                selected_program_id = ?,
                consultation_reason = ?,
                requested_services_json = ?,
                requested_changes_json = ?,
                preferred_date = ?,
                stage = ?
            WHERE id = ?""",
            (
                body.package_id,
                body.consultation_reason,
                json.dumps(body.requested_services, ensure_ascii=False),
                json.dumps(body.requested_changes, ensure_ascii=False),
                body.preferred_date,
                "package_selected",
                case_id,
            ),
        )
        selection_id = new_id("sel")
        audit(
            conn,
            case_id,
            actor.patient_id or actor.token or "patient",
            "selection_saved",
            {
                "selection_id": selection_id,
                "revision_id": body.revision_id,
                "package_id": body.package_id,
            },
        )
        conn.commit()
    return {
        "contract_version": CONTRACT_VERSION,
        "case_id": case_id,
        "revision_id": body.revision_id,
        "package_id": body.package_id,
        "consultation_reason": body.consultation_reason,
        "requested_services": body.requested_services,
        "requested_changes": body.requested_changes,
        "preferred_date": body.preferred_date,
        "state": "package_selected",
        "is_demo": True,
        "catalogue_version": CATALOGUE_VERSION,
    }
