from __future__ import annotations


def test_availability_local_date_and_busy_without_names(client):
    res = client.get("/api/therapists/demo-therapist-01/availability?date=2026-10-06")
    assert res.status_code == 200
    body = res.json()
    assert body["timezone"] == "Asia/Almaty"
    assert body["therapist"]["id"] == "demo-therapist-01"
    assert body["therapist"]["is_demo"] is True
    ids = {s["id"]: s for s in body["slots"]}
    assert "demo-slot-1006-1000" in ids
    assert "demo-slot-1006-1030" in ids
    assert "demo-slot-1006-1100" in ids
    assert ids["demo-slot-1006-1000"]["availability"] == "busy"
    assert ids["demo-slot-1006-1030"]["availability"] == "busy"
    assert ids["demo-slot-1006-1100"]["availability"] == "available"
    blob = res.text.lower()
    assert "demo-клиент" not in blob
    assert "patient-03" not in blob
    assert "contact_name" not in blob
    for slot in body["slots"]:
        assert set(slot) == {"id", "therapist_id", "starts_at", "ends_at", "availability"}


def test_availability_unknown_therapist(client):
    res = client.get("/api/therapists/missing/availability?date=2026-10-06")
    assert res.status_code == 404


def test_generated_slots_and_month_view(client):
    day = client.get("/api/therapists/demo-therapist-01/availability?date=2026-10-12").json()
    assert len(day["slots"]) == 18  # 09:00–17:30 every 30 min, Monday
    assert any(s["availability"] == "busy" for s in day["slots"])
    assert any(s["availability"] == "available" for s in day["slots"])
    month = client.get("/api/therapists/demo-therapist-01/availability/month?month=2026-10")
    assert month.status_code == 200
    days = {d["date"]: d for d in month.json()["days"]}
    assert "2026-10-10" not in days  # Saturday
    assert days["2026-10-12"]["available"] + days["2026-10-12"]["busy"] == 18
    assert client.get("/api/therapists/demo-therapist-01/availability/month?month=bad").status_code == 422
