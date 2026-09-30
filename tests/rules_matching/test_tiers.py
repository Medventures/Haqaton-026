from __future__ import annotations

from copy import deepcopy

import pytest

from app.conditions import condition_met



def submission(answers: dict, revision_id: str) -> dict:
    return {
        "contract_version": "v4",
        "revision_id": revision_id,
        "questionnaire_version": "demo-intake-v1",
        "processing_consent": {"granted": True, "text_version": "demo-processing-v1"},
        "answers": answers,
        "doctor_note": None,
    }


def _preview(client, answers, rid="t"):
    res = client.post("/api/preview", json=submission(answers, rid))
    assert res.status_code == 200, res.text
    return res.json()


def _ids(group):
    return group["optimal"]["package_id"], group["maximum"]["package_id"]


def test_condition_grammar():
    a = {"age_years": 56, "exam_applicability": "female", "family": ["cancer", "heart"]}
    assert condition_met({"id": "age_years", "gt": 55}, a)
    assert not condition_met({"id": "age_years", "lte": 55}, a)
    assert condition_met({"id": "family", "in": ["cancer"]}, a)
    assert condition_met({"all": [{"id": "exam_applicability", "eq": "female"}, {"id": "age_years", "gte": 41}]}, a)
    assert condition_met({"any": [{"id": "x", "eq": 1}, {"id": "age_years", "gte": 50}]}, a)
    assert condition_met({"not": {"id": "x", "exists": True}}, a)
    assert not condition_met({"id": "missing", "lte": 3}, a)


def test_pregnancy_hidden_for_men_and_after_55(client, matching_fixtures):
    config = client.get("/api/config/questionnaire").json()
    order = [q["id"] for q in config["questions"]]
    assert order[:4] == ["age_years", "exam_applicability", "pregnancy", "visit_reason"]
    preg = next(q for q in config["questions"] if q["id"] == "pregnancy")
    assert condition_met(preg["show_if"], {"age_years": 30, "exam_applicability": "female"})
    assert condition_met(preg["show_if"], {"age_years": 30, "exam_applicability": "discuss"})
    assert not condition_met(preg["show_if"], {"age_years": 30, "exam_applicability": "male"})
    assert not condition_met(preg["show_if"], {"age_years": 56, "exam_applicability": "female"})

    # 56-year-old woman: pregnancy not required, a stale answer is ignored.
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["age_years"] = 56
    answers.pop("pregnancy")
    assert _preview(client, answers, "p56")["workflow_class"] == "catalogue_only"
    answers["pregnancy"] = "yes"
    assert _preview(client, answers, "p56b")["workflow_class"] == "catalogue_only"

    # 30-year-old woman without pregnancy answer → 422 (required).
    young = deepcopy(matching_fixtures["baseline_clean_female"])
    young["age_years"] = 30
    young.pop("pregnancy")
    res = client.post("/api/preview", json=submission(young, "p30"))
    assert res.status_code == 422
    assert "pregnancy" in res.json()["error"]["field_errors"]


def test_offer_under_40_optimal_basic_maximum_extended(client, matching_fixtures):
    p = _preview(client, matching_fixtures["baseline_clean_female"], "u40")
    offer = p["offer"]
    assert offer and len(offer["groups"]) == 1
    g = offer["groups"][0]
    assert _ids(g) == ("w-basic-u40", "w-extended-40p")
    assert set(g["maximum"]["extra_block_ids"]) == {"oncology_markers", "mammography", "ultrasound"}
    assert offer["recommended"] == "optimal"
    assert offer["cta"] == "book"
    assert g["optimal"]["price_minor"] == 302740 and g["maximum"]["price_minor"] == 338000
    assert g["maximum"]["price_old_minor"] > g["maximum"]["price_minor"] and g["optimal"]["price_old_minor"] is None
    rows = {r["block_id"]: r for r in g["comparison"]}
    assert rows["mammography"]["optimal"] is False and rows["mammography"]["maximum"] is True
    assert "plain_checkup" in offer["factors"]


def test_offer_family_cancer_recommends_maximum_for_woman_u40(client, matching_fixtures):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["family"] = ["cancer"]
    offer = _preview(client, answers, "fc")["offer"]
    assert offer["recommended"] == "maximum"
    assert "family_cancer" in offer["factors"]
    assert offer["explanations"][0]["id"] == "family_cancer"


def test_offer_age_40_no_recommendation_discuss(client, matching_fixtures):
    answers = deepcopy(matching_fixtures["baseline_clean_male"])
    answers["age_years"] = 40
    offer = _preview(client, answers, "a40")["offer"]
    assert offer["recommended"] is None
    assert offer["cta"] == "discuss"
    assert _ids(offer["groups"][0]) == ("m-basic-u40", "m-extended-40p")


def test_offer_41_plus_adapted_maximum(client, matching_fixtures):
    answers = deepcopy(matching_fixtures["baseline_clean_male"])
    answers["age_years"] = 50
    answers["tobacco"] = "current_cigarettes"
    offer = _preview(client, answers, "a50")["offer"]
    g = offer["groups"][0]
    assert _ids(g) == ("m-extended-40p", "m-extended-40p")
    assert g["maximum"]["variant"] == "adapted"
    assert any("пульмонолог" in t for t in g["maximum"]["adaptation_ru"])
    assert offer["recommended"] == "maximum"

    clean = deepcopy(matching_fixtures["baseline_clean_male"])
    clean["age_years"] = 50
    offer = _preview(client, clean, "a50c")["offer"]
    assert offer["recommended"] == "optimal"
    assert offer["groups"][0]["maximum"]["adaptation_ru"]


def test_offer_discuss_sex_two_groups_and_review_cta(client, matching_fixtures):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers["exam_applicability"] = "discuss"
    offer = _preview(client, answers, "dsx")["offer"]
    assert [g["sex"] for g in offer["groups"]] == ["female", "male"]
    assert offer["cta"] == "discuss"


@pytest.mark.parametrize(
    "patch",
    [
        {"age_years": 17},
        {"symptoms": ["chest_pain_severe"]},
    ],
)
def test_no_offer_for_handoff(client, matching_fixtures, patch):
    answers = deepcopy(matching_fixtures["baseline_clean_female"])
    answers.update(patch)
    p = _preview(client, answers, "h")
    assert p["offer"] is None
    if "symptoms" in patch:
        assert p["explanations"][0]["id"] == "safety_first"
