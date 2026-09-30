"""Demo admin: one account with coordinator + doctor rights for testing and demos."""

ADMIN = {"X-Owner-Session": "demo-admin"}


def test_admin_session_and_full_access(client):
    s = client.post("/api/demo/session", json={"role": "admin"})
    assert s.status_code == 200, s.text
    assert s.json()["role"] == "admin"

    rows = client.get("/api/staff/patients", headers=ADMIN)
    assert rows.status_code == 200 and len(rows.json()["patients"]) >= 8

    # Doctor-level read: questionnaire visible.
    case = client.get("/api/staff/cases/case-03", headers=ADMIN).json()
    assert case["questionnaire"]["answers"]["age_years"] == 44

    # Coordinator-level write.
    patched = client.patch("/api/staff/cases/case-03", json={"notes": "admin note"}, headers=ADMIN)
    assert patched.status_code == 200, patched.text

    # Doctor-level write: physician plan.
    plan = client.post(
        "/api/cases/case-04/physician-plan",
        json={"revision_id": "rev-04", "template_id": "demo-plan-basic"},
        headers=ADMIN,
    )
    assert plan.status_code in (200, 201), plan.text

    assert client.get("/api/staff/analytics/funnel", headers=ADMIN).status_code == 200


def test_patient_cannot_use_staff_endpoints(client):
    res = client.get("/api/staff/patients", headers={"X-Owner-Session": "owner-patient-01"})
    assert res.status_code == 403
