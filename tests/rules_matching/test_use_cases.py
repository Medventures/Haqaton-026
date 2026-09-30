"""Use-case matrix: realistic personas → which questions they see → workflow, offer and CTA.

Each persona is the full answer set a patient would give in the quiz. The test checks
branching (visible questions), that the preview validates, and the rule-based outcome.
Mirror of the table in .agent/PLAN_V7.md §Use cases.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.conditions import condition_met

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = json.loads((ROOT / "data" / "questionnaire.json").read_text(encoding="utf-8"))["questions"]

BASE = {
    "visit_reason": "prevention",
    "symptoms": ["none"],
    "conditions": ["none"],
    "medicines": "no",
    "family": ["none"],
    "tobacco": "never",
    "prior_results": "no",
}


def visible_ids(answers: dict) -> list[str]:
    return [q["id"] for q in QUESTIONS if condition_met(q.get("show_if"), answers)]


def body(answers: dict, rid: str) -> dict:
    return {
        "contract_version": "v4",
        "revision_id": rid,
        "questionnaire_version": "demo-intake-v1",
        "processing_consent": {"granted": True, "text_version": "demo-processing-v1"},
        "answers": answers,
        "doctor_note": None,
    }


# id, answers, visible-count, workflow, offer groups (optimal, maximum) or None, recommended, cta, must-have factor
PERSONAS = [
    ("woman_28_clean", {"age_years": 28, "exam_applicability": "female", "pregnancy": "no"},
     10, "catalogue_only", ("w-basic-u40", "w-extended-40p"), "optimal", "book", "plain_checkup"),
    ("man_35_smoker", {"age_years": 35, "exam_applicability": "male", "tobacco": "current_cigarettes"},
     9, "catalogue_only", ("m-basic-u40", "m-extended-40p"), "optimal", "book", "smoker"),
    ("woman_33_family_cancer", {"age_years": 33, "exam_applicability": "female", "pregnancy": "no", "family": ["cancer"]},
     10, "catalogue_only", ("w-basic-u40", "w-extended-40p"), "maximum", "book", "family_cancer"),
    ("woman_30_pregnant", {"age_years": 30, "exam_applicability": "female", "pregnancy": "yes"},
     10, "pregnancy_review", ("w-basic-u40", "w-extended-40p"), "optimal", "discuss", "pregnancy"),
    ("man_40_boundary", {"age_years": 40, "exam_applicability": "male"},
     9, "catalogue_only", ("m-basic-u40", "m-extended-40p"), None, "discuss", "age_boundary"),
    ("woman_45_clean", {"age_years": 45, "exam_applicability": "female", "pregnancy": "no"},
     10, "catalogue_only", ("w-extended-40p", "w-extended-40p"), "optimal", "book", "female_40p"),
    ("woman_60_no_pregnancy_q", {"age_years": 60, "exam_applicability": "female"},
     9, "catalogue_only", ("w-extended-40p", "w-extended-40p"), "optimal", "book", "female_40p"),
    ("man_52_heart_complaint_meds", {"age_years": 52, "exam_applicability": "male", "visit_reason": "complaints",
     "complaint_topic": "heart", "conditions": ["blood_pressure"], "medicines": "yes", "medicine_groups": ["pressure"]},
     11, "needs_clinician_review", ("m-extended-40p", "m-extended-40p"), "maximum", "discuss", "heart"),
    ("man_45_digestion", {"age_years": 45, "exam_applicability": "male", "visit_reason": "complaints", "complaint_topic": "digestion"},
     10, "needs_clinician_review", ("m-extended-40p", "m-extended-40p"), "maximum", "discuss", "digestion"),
    ("woman_29_digestion", {"age_years": 29, "exam_applicability": "female", "pregnancy": "no",
     "visit_reason": "complaints", "complaint_topic": "digestion"},
     11, "needs_clinician_review", ("w-basic-u40", "w-extended-40p"), "maximum", "discuss", "digestion"),
    ("discuss_sex_25", {"age_years": 25, "exam_applicability": "discuss", "pregnancy": "not_applicable"},
     10, "needs_clinician_review", ("w-basic-u40", "w-extended-40p"), "optimal", "discuss", "under40_max"),
    ("man_38_other_symptoms", {"age_years": 38, "exam_applicability": "male", "symptoms": ["other"]},
     9, "needs_clinician_review", ("m-basic-u40", "m-extended-40p"), "optimal", "discuss", "symptoms_discuss"),
    ("woman_50_prior_results", {"age_years": 50, "exam_applicability": "female", "prior_results": "yes",
     "result_types": ["labs", "ultrasound"], "visit_reason": "follow_up", "pregnancy": "no"},
     11, "catalogue_only", ("w-extended-40p", "w-extended-40p"), "maximum", "book", "prior_results"),
    ("man_30_employer", {"age_years": 30, "exam_applicability": "male", "visit_reason": "employer"},
     9, "catalogue_only", ("m-basic-u40", "m-extended-40p"), "optimal", "book", "employer"),
    ("teen_16", {"age_years": 16, "exam_applicability": "female"},
     9, "adult_scope_excluded", None, None, None, None),
    ("chest_pain_now", {"age_years": 55, "exam_applicability": "male", "symptoms": ["chest_pain_severe"]},
     9, "safety_stop", None, None, None, "safety_first"),
]


@pytest.mark.parametrize("pid,patch,n_visible,workflow,pair,recommended,cta,factor", PERSONAS, ids=[p[0] for p in PERSONAS])
def test_persona(client, pid, patch, n_visible, workflow, pair, recommended, cta, factor):
    answers = {**BASE, **patch}
    visible = visible_ids(answers)
    assert len(visible) == n_visible, visible
    # Men and women over 55 never see the pregnancy question.
    if answers["exam_applicability"] == "male" or answers["age_years"] > 55 or answers["age_years"] < 18:
        assert "pregnancy" not in visible
    # Submit only what the quiz would send (hidden answers dropped).
    sent = {k: v for k, v in answers.items() if k in visible}
    res = client.post("/api/preview", json=body(sent, pid))
    assert res.status_code == 200, res.text
    p = res.json()
    assert p["workflow_class"] == workflow
    offer = p["offer"]
    if pair is None:
        assert offer is None
    else:
        g = offer["groups"][0]
        assert (g["optimal"]["package_id"], g["maximum"]["package_id"]) == pair
        assert offer["recommended"] == recommended
        assert offer["cta"] == cta
        assert all(t["price_minor"] > 0 for grp in offer["groups"] for t in (grp["optimal"], grp["maximum"]))
    if factor:
        assert factor in [e["id"] for e in p["explanations"]] or (offer and factor in offer["factors"])


def test_branch_extremes():
    lean = {**BASE, "age_years": 30, "exam_applicability": "male"}
    assert len(visible_ids(lean)) == 9
    full = {
        **BASE,
        "age_years": 30,
        "exam_applicability": "female",
        "visit_reason": "complaints",
        "medicines": "yes",
        "prior_results": "yes",
    }
    assert len(visible_ids(full)) == 13
