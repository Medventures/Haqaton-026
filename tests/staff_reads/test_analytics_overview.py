"""Business dashboard: aggregates only, staff only, synthetic population makes it non-empty."""

from app.db import connect
from app.demo_population import ensure_synthetic_population

ADMIN = {"X-Owner-Session": "demo-admin"}


def test_overview_requires_staff(client):
    assert client.get("/api/staff/analytics/overview").status_code in (401, 403)
    assert client.get("/api/staff/analytics/overview", headers={"X-Owner-Session": "owner-patient-01"}).status_code == 403


def test_overview_with_synthetic_population(client):
    with connect() as conn:
        ensure_synthetic_population(conn)
        ensure_synthetic_population(conn)  # idempotent
    res = client.get("/api/staff/analytics/overview", headers=ADMIN)
    assert res.status_code == 200, res.text
    d = res.json()
    assert d["kpis"]["clients"] >= 57
    assert d["kpis"]["sessions"] >= 180
    steps = [s["count"] for s in d["funnel"]]
    assert steps == sorted(steps, reverse=True) and steps[-1] > 0
    assert sum(t["count"] for t in d["tiers"]) == d["kpis"]["clients"] - 0 or sum(t["count"] for t in d["tiers"]) > 0
    q = {x["id"]: x for x in d["questions"]}
    assert q["exam_applicability"]["respondents"] > 0
    assert q["age_years"]["views"] > q["result_types"]["views"]
    assert q["symptoms"]["drop_off"] is not None
    assert d["factors"] and d["programs"]
    blob = res.text
    for forbidden in ("+7701", "syn-patient", "answers_json"):
        assert forbidden not in blob
