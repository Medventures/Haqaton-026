from __future__ import annotations

import os
import sqlite3
from copy import deepcopy

from fastapi.testclient import TestClient

from app.matching import derive_needs


def submission(answers: dict, revision_id: str = "anon-r1") -> dict:
    return {
        "contract_version": "v4",
        "revision_id": revision_id,
        "questionnaire_version": "demo-intake-v1",
        "processing_consent": {"granted": True, "text_version": "demo-processing-v1"},
        "answers": answers,
        "doctor_note": None,
    }


def _with_age(base: dict, age: int) -> dict:
    answers = deepcopy(base)
    answers["age_years"] = age
    return answers


def test_age_boundaries_parametrized(client: TestClient, matching_fixtures: dict):
    base = matching_fixtures["baseline_clean_female"]
    cases = [
        (17, "adult_scope_excluded", True, None),
        (39, "catalogue_only", False, ["policy_unapproved"]),
        (40, "catalogue_only", False, ["age_boundary_unresolved", "policy_unapproved"]),
        (41, "catalogue_only", False, ["policy_unapproved"]),
    ]
    for age, workflow, empty_candidates, flags in cases:
        body = submission(_with_age(base, age), revision_id=f"age-{age}")
        response = client.post("/api/preview", json=body)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["revision_id"] == f"age-{age}"
        assert payload["mode"] == "anonymous"
        assert payload["workflow_class"] == workflow
        assert payload["is_demo"] is True
        if empty_candidates:
            assert payload["candidates"] == []
        else:
            assert payload["candidates"]
            assert all(isinstance(c["price_minor"], int) and c["price_minor"] > 0 for c in payload["candidates"])
            ids = {c["package_id"] for c in payload["candidates"]}
            assert not ids & {"demo-discuss", "demo-prevention-a", "demo-prevention-b"}
            if age == 39:
                assert ids == {"w-basic-u40"}
            elif age == 41:
                assert ids == {"w-extended-40p"}
            elif age == 40:
                assert ids == {"w-basic-u40", "w-extended-40p"}
                assert all(c["eligibility"] == "needs_review" for c in payload["candidates"])
        if flags is not None:
            for flag in flags:
                assert flag in payload["review_flags"]
        if age != 40:
            assert "age_boundary_unresolved" not in payload["review_flags"]


def test_sex_filters_and_discuss_shows_both(client: TestClient, matching_fixtures: dict):
    female = client.post(
        "/api/preview",
        json=submission(matching_fixtures["baseline_clean_female"], "sex-f"),
    ).json()
    male = client.post(
        "/api/preview",
        json=submission(matching_fixtures["baseline_clean_male"], "sex-m"),
    ).json()
    discuss_answers = deepcopy(matching_fixtures["baseline_clean_female"])
    discuss_answers["exam_applicability"] = "discuss"
    discuss_answers["pregnancy"] = "no"
    discuss = client.post("/api/preview", json=submission(discuss_answers, "sex-d")).json()

    assert {c["package_id"] for c in female["candidates"]} == {"w-basic-u40"}
    assert {c["package_id"] for c in male["candidates"]} == {"m-basic-u40"}
    discuss_ids = {c["package_id"] for c in discuss["candidates"]}
    assert discuss_ids == {"w-basic-u40", "m-basic-u40"}
    assert "m-basic-u40" in discuss_ids  # not male-defaulted to only male


def test_derive_needs_maps_answers_not_empty():
    heart = {
        "visit_reason": "complaints",
        "complaint_topic": "heart",
        "conditions": ["none"],
        "tobacco": "never",
        "medicines": "no",
    }
    assert "cardio" in (derive_needs(heart) or [])

    tobacco = {
        "visit_reason": "prevention",
        "conditions": ["none"],
        "tobacco": "current_cigarettes",
        "medicines": "no",
    }
    assert "lung_ct" in (derive_needs(tobacco) or [])

    medicines_only = {
        "visit_reason": "prevention",
        "conditions": ["none"],
        "tobacco": "never",
        "medicines": "yes",
        "medicine_groups": ["pressure"],
    }
    assert derive_needs(medicines_only) == []

    clean = {
        "visit_reason": "prevention",
        "conditions": ["none"],
        "tobacco": "never",
        "medicines": "no",
        "symptoms": ["none"],
    }
    assert derive_needs(clean) == []


def test_heart_need_ranks_package_with_human_reason(client: TestClient, matching_fixtures: dict):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["visit_reason"] = "complaints"
    answers["complaint_topic"] = "heart"
    answers["symptoms"] = ["none"]
    payload = client.post("/api/preview", json=submission(answers, "need-heart")).json()
    assert payload["candidates"]
    top = payload["candidates"][0]
    assert top["package_id"] == "w-basic-u40"
    reason_codes = [r["code"] for r in top["reasons"]]
    assert "need_cardio" in reason_codes
    cardio_reason = next(r for r in top["reasons"] if r["code"] == "need_cardio")
    assert cardio_reason["text_ru"]
    assert cardio_reason["text_ru"][0].isupper()
    assert "need_cardio" not in cardio_reason["text_ru"]
    assert "demo_" not in (cardio_reason.get("text_ru") or "")


def test_empty_needs_do_not_claim_full_coverage(client: TestClient, matching_fixtures: dict):
    payload = client.post(
        "/api/preview",
        json=submission(matching_fixtures["baseline_clean_female"], "empty-d"),
    ).json()
    assert payload["candidates"]
    for candidate in payload["candidates"]:
        codes = [r["code"] for r in candidate["reasons"]]
        assert "empty_needs" in codes
        assert "needs_unverified" in candidate["review_flags"]
        # No invented score: reasons carry empty_needs, not a 100% claim; price comes from catalogue.
        assert candidate["price_minor"] == 302740


def test_unknown_vs_no_pregnancy_and_medicines(client: TestClient, matching_fixtures: dict):
    base = matching_fixtures["baseline_clean_female"]

    pregnancy_no = submission(base, "preg-no")
    pregnancy_unknown = deepcopy(base)
    pregnancy_unknown["pregnancy"] = "unknown"
    unknown_body = submission(pregnancy_unknown, "preg-unknown")

    no_resp = client.post("/api/preview", json=pregnancy_no).json()
    unknown_resp = client.post("/api/preview", json=unknown_body).json()
    assert no_resp["workflow_class"] == "catalogue_only"
    assert unknown_resp["workflow_class"] == "pregnancy_review"
    assert all(c["eligibility"] == "needs_review" for c in unknown_resp["candidates"])
    # Pregnancy review must not auto-pick a standard eligible package.
    assert not any(c["eligibility"] == "eligible" for c in unknown_resp["candidates"])

    medicines_unknown = deepcopy(base)
    medicines_unknown["medicines"] = "unknown"
    med_unknown = client.post("/api/preview", json=submission(medicines_unknown, "med-u")).json()
    medicines_yes = deepcopy(base)
    medicines_yes["medicines"] = "yes"
    medicines_yes["medicine_groups"] = ["pressure"]
    med_yes = client.post("/api/preview", json=submission(medicines_yes, "med-y")).json()
    assert med_unknown["workflow_class"] == "catalogue_only"
    assert med_yes["workflow_class"] == "needs_clinician_review"
    med_codes = [r["code"] for r in med_yes["candidates"][0]["reasons"]]
    assert "medicines_discuss" in med_codes


def test_exclusive_none_plus_positive_422(client: TestClient, matching_fixtures: dict):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["symptoms"] = ["none", "other"]
    response = client.post("/api/preview", json=submission(answers, "excl"))
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["field_errors"]["symptoms"] == "exclusive_conflict"


def test_hidden_stale_answer_ignored(client: TestClient, matching_fixtures: dict):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["visit_reason"] = "prevention"
    answers["complaint_topic"] = "heart"
    response = client.post("/api/preview", json=submission(answers, "hidden"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["workflow_class"] == "catalogue_only"
    # Hidden complaint_topic must not drive needs/reasons when visit_reason is prevention.
    top_codes = [r["code"] for r in payload["candidates"][0]["reasons"]]
    assert "need_cardio" not in top_codes

    # Persist path also drops hidden fields from active projection.
    create = client.post(
        "/api/cases",
        json={
            **submission(answers, "saved-hidden"),
            "clinic_transfer": {"granted": True, "text_version": "demo-transfer-v1"},
            "contact_name": "Hidden Test",
            "phone": "+77001112233",
        },
    )
    assert create.status_code == 200, create.text
    case = create.json()
    headers = {"X-Owner-Session": case["owner_session"]}
    saved = client.put(
        f"/api/cases/{case['case_id']}/questionnaire",
        json=submission(answers, "rev-client"),
        headers=headers,
    )
    assert saved.status_code == 200
    rec = client.post(f"/api/cases/{case['case_id']}/recommendations", headers=headers)
    assert rec.status_code == 200
    assert rec.json()["workflow_class"] == "catalogue_only"


def test_anonymous_preview_does_not_increase_patient_count(client: TestClient, matching_fixtures: dict):
    path = os.environ["PRIME_DB"]
    before = sqlite3.connect(path).execute("SELECT COUNT(*) FROM patients").fetchone()[0]
    cases_before = sqlite3.connect(path).execute("SELECT COUNT(*) FROM cases").fetchone()[0]
    response = client.post(
        "/api/preview",
        json=submission(matching_fixtures["baseline_clean_female"], "anon-count"),
    )
    assert response.status_code == 200
    after = sqlite3.connect(path).execute("SELECT COUNT(*) FROM patients").fetchone()[0]
    cases_after = sqlite3.connect(path).execute("SELECT COUNT(*) FROM cases").fetchone()[0]
    assert after == before
    assert cases_after == cases_before


def test_price_comes_from_catalogue(client: TestClient, matching_fixtures: dict):
    response = client.post(
        "/api/preview",
        json=submission(matching_fixtures["baseline_clean_male"], "price-null"),
    )
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert candidates
    for candidate in candidates:
        assert candidate["price_minor"] == 292220
        assert candidate["currency"] == "KZT"
        assert candidate["composition_status"] == "incomplete"  # partial mapped for contract


def test_selection_stale_revision_409(client: TestClient, matching_fixtures: dict):
    create = client.post(
        "/api/cases",
        json={
            **submission(matching_fixtures["baseline_clean_male"], "sel-1"),
            "clinic_transfer": {"granted": True, "text_version": "demo-transfer-v1"},
            "contact_name": "Select Test",
            "phone": "+77005556677",
        },
    )
    assert create.status_code == 200
    case = create.json()
    headers = {"X-Owner-Session": case["owner_session"]}
    updated = client.put(
        f"/api/cases/{case['case_id']}/questionnaire",
        json=submission(matching_fixtures["baseline_clean_male"], "sel-2"),
        headers=headers,
    )
    assert updated.status_code == 200
    new_rev = updated.json()["revision_id"]
    stale = client.put(
        f"/api/cases/{case['case_id']}/selection",
        json={
            "revision_id": case["revision_id"],
            "package_id": "m-basic-u40",
            "consultation_reason": "discuss_preliminary_programme",
            "requested_services": [],
            "requested_changes": [],
            "preferred_date": "2026-10-20",
        },
        headers=headers,
    )
    assert stale.status_code == 409
    ok = client.put(
        f"/api/cases/{case['case_id']}/selection",
        json={
            "revision_id": new_rev,
            "package_id": "m-basic-u40",
            "consultation_reason": "discuss_preliminary_programme",
            "preferred_date": "2026-10-20",
        },
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json()["package_id"] == "m-basic-u40"


def test_previsit_missing_not_negative(client: TestClient, matching_fixtures: dict):
    create = client.post(
        "/api/cases",
        json={
            **submission(matching_fixtures["baseline_clean_female"], "pre-1"),
            "clinic_transfer": {"granted": True, "text_version": "demo-transfer-v1"},
            "contact_name": "Previsit Test",
            "phone": "+77008889900",
        },
    )
    case = create.json()
    headers = {"X-Owner-Session": case["owner_session"]}
    # Partial previsit: omit medicines entirely — must not become "no".
    partial = {
        "contract_version": "v4",
        "revision_id": "previsit-partial",
        "questionnaire_version": "demo-intake-v1",
        "processing_consent": {"granted": True, "text_version": "demo-processing-v1"},
        "answers": {"tobacco": "former_cigarettes"},
        "doctor_note": None,
    }
    response = client.put(f"/api/cases/{case['case_id']}/previsit", json=partial, headers=headers)
    assert response.status_code == 200
    assert response.json()["kind"] == "previsit"
    assert "tobacco" in response.json()["active_fields"]
    assert "medicines" not in response.json()["active_fields"]


def test_safety_stop_precedence(client: TestClient, matching_fixtures: dict):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["symptoms"] = ["chest_pain_severe"]
    answers["pregnancy"] = "yes"
    response = client.post("/api/preview", json=submission(answers, "safety")).json()
    assert response["workflow_class"] == "safety_stop"
    assert response["candidates"] == []


def test_consent_required_for_preview(client: TestClient, matching_fixtures: dict):
    body = submission(matching_fixtures["baseline_clean_female"], "no-consent")
    body["processing_consent"] = {"granted": False, "text_version": "demo-processing-v1"}
    response = client.post("/api/preview", json=body)
    assert response.status_code == 422
