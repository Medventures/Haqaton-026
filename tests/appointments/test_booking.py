from __future__ import annotations

import threading

from app.db import connect
from app.errors import ApiError
from app.sessions import Actor


FREE_SLOT = "demo-slot-1006-1100"
BOOKED_SLOT = "demo-slot-1006-1000"


def _book_headers(owner: str, key: str, analytics: str = "analytics-booking-1") -> dict:
    return {
        "X-Owner-Session": owner,
        "Idempotency-Key": key,
        "X-Analytics-Session": analytics,
    }


def test_book_demo_confirmed_and_analytics(client):
    body = {
        "slot_id": FREE_SLOT,
        "revision_id": "rev-02",
        "consultation_reason": "discuss_preliminary_programme",
    }
    res = client.post(
        "/api/cases/case-02/appointments",
        json=body,
        headers=_book_headers("owner-patient-02", "idem-case-02-a"),
    )
    assert res.status_code == 200
    appt = res.json()
    assert appt["status"] == "demo_confirmed"
    assert appt["slot_id"] == FREE_SLOT
    assert appt["case_id"] == "case-02"
    assert appt["is_demo"] is True

    with connect() as conn:
        events = conn.execute(
            "SELECT name, operation_key, props_json, event_source FROM analytics_events WHERE name = 'appointment_confirmed'"
        ).fetchall()
        assert len(events) == 1
        assert events[0]["operation_key"] == appt["id"]
        assert events[0]["event_source"] == "server"
        assert events[0]["props_json"] == "{}"


def test_idempotent_replay_same_key(client):
    body = {
        "slot_id": "demo-slot-1007-1000",
        "revision_id": "rev-01",
        "consultation_reason": "discuss_preliminary_programme",
    }
    headers = _book_headers("owner-patient-01", "idem-replay-1")
    first = client.post("/api/cases/case-01/appointments", json=body, headers=headers)
    assert first.status_code == 200
    second = client.post("/api/cases/case-01/appointments", json=body, headers=headers)
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    with connect() as conn:
        rows = conn.execute(
            "SELECT COUNT(*) AS n FROM appointments WHERE case_id = 'case-01' AND status != 'cancelled'"
        ).fetchone()
        assert rows["n"] == 1
        events = conn.execute(
            "SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'appointment_confirmed' AND operation_key = ?",
            (first.json()["id"],),
        ).fetchone()
        assert events["n"] == 1


def test_idempotency_mismatch(client):
    headers = _book_headers("owner-patient-01", "idem-mismatch-1")
    first = client.post(
        "/api/cases/case-01/appointments",
        json={
            "slot_id": "demo-slot-1007-1000",
            "revision_id": "rev-01",
            "consultation_reason": "discuss_preliminary_programme",
        },
        headers=headers,
    )
    assert first.status_code == 200
    second = client.post(
        "/api/cases/case-01/appointments",
        json={
            "slot_id": "demo-slot-1008-1400",
            "revision_id": "rev-01",
            "consultation_reason": "discuss_preliminary_programme",
        },
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "idempotency_mismatch"


def test_occupied_slot_conflict(client):
    res = client.post(
        "/api/cases/case-02/appointments",
        json={
            "slot_id": BOOKED_SLOT,
            "revision_id": "rev-02",
            "consultation_reason": "discuss_preliminary_programme",
        },
        headers=_book_headers("owner-patient-02", "idem-conflict-seed"),
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "slot_conflict"


def test_consent_required(client):
    from app.db import connect

    with connect() as conn:
        conn.execute("DELETE FROM consents WHERE case_id = 'case-01'")
        conn.commit()
    res = client.post(
        "/api/cases/case-01/appointments",
        json={
            "slot_id": "demo-slot-1007-1000",
            "revision_id": "rev-01",
            "consultation_reason": "discuss_preliminary_programme",
        },
        headers=_book_headers("owner-patient-01", "idem-no-consent"),
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "transfer_required"


def test_same_slot_race_two_connections(db_path):
    from app.appointments import book_appointment
    from app.contracts import AppointmentBody
    from app.db import connect, transaction

    barrier = threading.Barrier(2)
    outcomes: list = []

    def worker(case_id: str, owner_patient: str, revision: str, key: str) -> None:
        barrier.wait()
        try:
            with transaction() as conn:
                case = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
                actor = Actor("patient", f"owner-{owner_patient}", owner_patient, None, "analytics-race")
                body = AppointmentBody(
                    slot_id=FREE_SLOT,
                    revision_id=revision,
                    consultation_reason="discuss_preliminary_programme",
                )
                appt, created = book_appointment(
                    conn,
                    case=case,
                    actor=actor,
                    body=body,
                    idempotency_key=key,
                )
                outcomes.append(("ok", appt["id"], created, case_id))
        except ApiError as exc:
            outcomes.append(("err", exc.status, exc.code, case_id))

    t1 = threading.Thread(target=worker, args=("case-01", "patient-01", "rev-01", "race-k1"))
    t2 = threading.Thread(target=worker, args=("case-02", "patient-02", "rev-02", "race-k2"))
    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    assert len(outcomes) == 2
    oks = [o for o in outcomes if o[0] == "ok"]
    errs = [o for o in outcomes if o[0] == "err"]
    assert len(oks) == 1
    assert len(errs) == 1
    assert errs[0][1] == 409
    assert errs[0][2] == "slot_conflict"

    with connect() as conn:
        rows = conn.execute(
            "SELECT case_id FROM appointments WHERE slot_id = ? AND status != 'cancelled'",
            (FREE_SLOT,),
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["case_id"] == oks[0][3]
