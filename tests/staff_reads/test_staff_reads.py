from __future__ import annotations


COORD = {"X-Owner-Session": "demo-coordinator"}
DOCTOR = {"X-Owner-Session": "demo-doctor"}


def test_staff_schedule_shows_booking(client):
    res = client.get("/api/staff/schedule?date=2026-10-06", headers=COORD)
    assert res.status_code == 200
    body = res.json()
    by_slot = {item["slot_id"]: item for item in body["items"]}
    assert by_slot["demo-slot-1006-1000"]["availability"] == "busy"
    assert by_slot["demo-slot-1006-1000"]["case_id"] == "case-03"
    assert by_slot["demo-slot-1006-1100"]["availability"] == "available"
    assert by_slot["demo-slot-1006-1100"]["case_id"] is None
    assert "questionnaire" not in res.text
    assert "answers" not in res.text


def test_staff_patients_all_seeded(client):
    res = client.get("/api/staff/patients", headers=COORD)
    assert res.status_code == 200
    patients = res.json()["patients"]
    assert len(patients) == 8
    ids = {p["patient_id"] for p in patients}
    assert ids == {f"patient-0{i}" for i in range(1, 9)}
    for row in patients:
        assert "next_action" in row
        assert "booked_starts_at" in row
        assert "questionnaire" not in row
    case03 = next(p for p in patients if p["case_id"] == "case-03")
    assert case03["preferred_date"] == "2026-10-08"
    assert case03["booked_starts_at"] == "2026-10-06T05:00:00Z"
    assert case03["appointment_status"] == "demo_confirmed"


def test_staff_patients_filters(client):
    by_stage = client.get("/api/staff/patients?stage=package_selected", headers=COORD)
    assert by_stage.status_code == 200
    assert len(by_stage.json()["patients"]) == 1
    assert by_stage.json()["patients"][0]["case_id"] == "case-02"

    by_prog = client.get("/api/staff/patients?programme=demo-prevention-a", headers=COORD)
    assert {p["case_id"] for p in by_prog.json()["patients"]} >= {"case-03", "case-05", "case-07"}

    by_date = client.get("/api/staff/patients?preferred_date=2026-10-08", headers=COORD)
    assert len(by_date.json()["patients"]) == 1
    assert by_date.json()["patients"][0]["case_id"] == "case-03"

    by_search = client.get("/api/staff/patients?search=Ерлан", headers=COORD)
    assert len(by_search.json()["patients"]) == 1
    assert by_search.json()["patients"][0]["patient_id"] == "patient-02"


def test_coordinator_case_has_no_questionnaire(client):
    res = client.get("/api/staff/cases/case-03", headers=COORD)
    assert res.status_code == 200
    body = res.json()
    assert "questionnaire" not in body
    assert body["case_id"] == "case-03"
    assert body["preferred_date"] == "2026-10-08"
    assert body["booked_starts_at"] == "2026-10-06T05:00:00Z"
    assert body["next_action"] == "await_consultation"


def test_doctor_case_has_questionnaire(client):
    res = client.get("/api/staff/cases/case-03", headers=DOCTOR)
    assert res.status_code == 200
    body = res.json()
    assert "questionnaire" in body
    assert body["questionnaire"]["answers"]["age_years"] == 44


def test_staff_patient_detail(client):
    res = client.get("/api/staff/patients/patient-03", headers=COORD)
    assert res.status_code == 200
    body = res.json()
    assert body["patient_id"] == "patient-03"
    assert len(body["cases"]) == 1
    assert "questionnaire" not in body["cases"][0]

    missing = client.get("/api/staff/patients/no-such", headers=COORD)
    assert missing.status_code == 404


def test_patch_org_fields_only(client):
    res = client.patch(
        "/api/staff/cases/case-01",
        json={"notes": "call tomorrow", "preferred_date": "2026-10-18", "owner_id": "demo-coordinator"},
        headers=COORD,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["notes"] == "call tomorrow"
    assert body["preferred_date"] == "2026-10-18"
    assert body["owner_id"] == "demo-coordinator"

    medical = client.patch(
        "/api/staff/cases/case-01",
        json={"answers": {"age_years": 99}, "doctor_note": "nope"},
        headers=COORD,
    )
    assert medical.status_code == 422
    assert medical.json()["error"]["field_errors"]["answers"] == "not_allowed"

    doctor_patch = client.patch(
        "/api/staff/cases/case-01",
        json={"notes": "doctor tries"},
        headers=DOCTOR,
    )
    assert doctor_patch.status_code == 403


def test_anonymous_not_in_list(client):
    res = client.get("/api/staff/patients", headers=COORD)
    assert all(p["patient_id"].startswith("patient-") for p in res.json()["patients"])
