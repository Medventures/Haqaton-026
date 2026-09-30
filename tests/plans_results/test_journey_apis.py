from fastapi.testclient import TestClient


def test_physician_plan_doctor_only_and_idempotent(client: TestClient, doctor_headers, coordinator_headers, patient_headers):
    denied_patient = client.post(
        "/api/cases/case-04/physician-plan",
        headers=patient_headers(4),
        json={"revision_id": "rev-04", "template_id": "demo-plan-basic"},
    )
    assert denied_patient.status_code == 403

    denied_coord = client.post(
        "/api/cases/case-04/physician-plan",
        headers=coordinator_headers,
        json={"revision_id": "rev-04", "template_id": "demo-plan-basic"},
    )
    assert denied_coord.status_code == 403

    first = client.post(
        "/api/cases/case-04/physician-plan",
        headers=doctor_headers,
        json={"revision_id": "rev-04", "template_id": "demo-plan-basic"},
    )
    assert first.status_code == 200
    body = first.json()
    assert body["id"]
    assert body["mode"] == "demo"
    assert body["approval_status"] == "unapproved"
    assert body["author_doctor_id"] == "demo-doctor"
    assert body["status"] == "confirmed"

    second = client.post(
        "/api/cases/case-04/physician-plan",
        headers=doctor_headers,
        json={"revision_id": "rev-04", "template_id": "demo-plan-basic"},
    )
    assert second.status_code == 200
    assert second.json()["id"] == body["id"]


def test_route_requires_plan_and_keeps_seed_feasible(client: TestClient, doctor_headers, patient_headers):
    no_plan = client.post("/api/cases/case-04/route", headers=doctor_headers)
    assert no_plan.status_code == 409
    assert no_plan.json()["error"]["code"] == "plan_not_approved"

    feasible = client.post("/api/cases/case-05/route", headers=doctor_headers)
    assert feasible.status_code == 200
    payload = feasible.json()
    assert payload["feasible"] is True
    ids = {item["id"] for item in payload["items"]}
    assert "route-05-1" in ids
    assert all(item["feasible"] for item in payload["items"])
    assert all(item["procedure_code"] != "therapist_visit" for item in payload["items"])

    again = client.post("/api/cases/case-05/route", headers=patient_headers(5))
    assert again.status_code == 200
    assert {item["id"] for item in again.json()["items"]} == ids


def test_impossible_route_has_no_fake_schedule(client: TestClient, doctor_headers):
    response = client.post("/api/cases/case-06/route", headers=doctor_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["feasible"] is False
    assert body["items"]
    for item in body["items"]:
        assert item["feasible"] is False
        assert item["starts_at"] is None
        assert item["ends_at"] is None
        assert item["outcome"]


def test_preparation_guard_and_checklist(client: TestClient, doctor_headers, patient_headers):
    missing = client.get("/api/cases/case-04/preparation", headers=doctor_headers)
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "plan_not_approved"

    prep = client.get("/api/cases/case-05/preparation", headers=patient_headers(5))
    assert prep.status_code == 200
    tasks = prep.json()["tasks"]
    assert 3 <= len(tasks) <= 5
    assert prep.json()["completion_is_clinical_clearance"] is False
    meds = [t for t in tasks if "лекарств" in t["action"].lower() or "Дозу" in t["action"]]
    assert meds
    assert all("мг" not in t["action"] for t in meds)


def test_patient_completes_own_prep_task_only(client: TestClient, patient_headers):
    ok = client.patch(
        "/api/tasks/task-05-prep-1",
        headers=patient_headers(5),
        json={"status": "completed"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "completed"
    assert ok.json()["clinical_clearance"] is False
    assert ok.json()["completed_at"]

    foreign = client.patch(
        "/api/tasks/task-05-prep-1",
        headers=patient_headers(6),
        json={"status": "completed"},
    )
    assert foreign.status_code == 404


def test_health_card_preserves_assertions_no_score(client: TestClient, patient_headers, doctor_headers):
    card = client.get("/api/cases/case-08/health-card", headers=patient_headers(8))
    assert card.status_code == 200
    body = card.json()
    assert "health_score" not in body
    assert "score" not in body
    assertions = {obs["assertion"] for rep in body["reports"] for obs in rep["observations"]}
    assert {"negated", "uncertain", "unknown"} <= assertions
    assert any(r["id"] == "report-08" for r in body["reports"])

    lab = client.get("/api/cases/case-07/health-card", headers=doctor_headers)
    assert lab.status_code == 200
    obs = [o for r in lab.json()["reports"] for o in r["observations"]]
    assert len([o for o in obs if o["value"] is not None]) >= 3


def test_results_review_follow_up_rules(client: TestClient, doctor_headers, patient_headers, coordinator_headers):
    denied = client.post(
        "/api/cases/case-07/results-review",
        headers=patient_headers(7),
        json={"revision_id": "rev-07"},
    )
    assert denied.status_code == 403
    denied_c = client.post(
        "/api/cases/case-07/results-review",
        headers=coordinator_headers,
        json={"revision_id": "rev-07"},
    )
    assert denied_c.status_code == 403

    none = client.post(
        "/api/cases/case-07/results-review",
        headers=doctor_headers,
        json={"revision_id": "rev-07"},
    )
    assert none.status_code == 200
    assert none.json()["tasks_created"] == []
    assert none.json()["tasks"] == []

    first = client.post(
        "/api/cases/case-08/results-review",
        headers=doctor_headers,
        json={"revision_id": "rev-08"},
    )
    assert first.status_code == 200
    tasks = first.json()["tasks"]
    assert 1 <= len(tasks) <= 2
    assert any(t["id"] == "task-08-follow" for t in tasks)
    assert all(t["due_at"] is None for t in tasks)
    created_ids = {t["id"] for t in first.json()["tasks_created"]}

    second = client.post(
        "/api/cases/case-08/results-review",
        headers=doctor_headers,
        json={"revision_id": "rev-08"},
    )
    assert second.status_code == 200
    assert second.json()["tasks_created"] == []
    assert {t["id"] for t in second.json()["tasks"]} == {t["id"] for t in tasks}
    assert "task-08-follow" in {t["id"] for t in second.json()["tasks"]}
    # First pass may create the second source-linked task once; never again.
    assert len(created_ids) <= 1


def test_calendar_ics_skips_null_dates(client: TestClient, doctor_headers):
    client.post("/api/cases/case-05/route", headers=doctor_headers)
    ics = client.get("/api/cases/case-05/calendar.ics", headers=doctor_headers)
    assert ics.status_code == 200
    assert "text/calendar" in ics.headers["content-type"]
    text = ics.text
    assert "BEGIN:VCALENDAR" in text
    assert "route-05-1" in text or "demo_lab" in text
    assert "DTSTART:" in text

    impossible = client.post("/api/cases/case-06/route", headers=doctor_headers)
    assert impossible.status_code == 200
    ics6 = client.get("/api/cases/case-06/calendar.ics", headers=doctor_headers)
    assert ics6.status_code == 200
    # Impossible items have null dates and must not appear as VEVENT.
    assert "demo_lab" not in ics6.text or "BEGIN:VEVENT" not in ics6.text
