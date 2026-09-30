"""SMS one-time-code login: cooldown, attempts, expiry, admin number, no enumeration."""

from datetime import datetime, timedelta, timezone

from app.db import connect


def _request(client, phone="+77000000005"):
    return client.post("/api/patient/otp/request", json={"phone": phone})


def test_otp_happy_path(client):
    res = _request(client)
    assert res.status_code == 200, res.text
    assert res.json()["sent"] is True
    ok = client.post("/api/patient/otp/verify", json={"phone": "8 700 000 00 05", "code": "0000"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["role"] == "patient" and ok.json()["patient_id"] == "patient-05"
    # Code is single-use.
    again = client.post("/api/patient/otp/verify", json={"phone": "+77000000005", "code": "0000"})
    assert again.status_code == 401


def test_otp_cooldown_and_unknown_number_same_answer(client):
    assert _request(client, "+77001112233").status_code == 200  # unknown number: no enumeration
    second = _request(client, "+77001112233")
    assert second.status_code == 429 and second.json()["error"]["code"] == "otp_cooldown"
    verify = client.post("/api/patient/otp/verify", json={"phone": "+77001112233", "code": "0000"})
    assert verify.status_code == 404  # only after proving the phone


def test_otp_attempt_lock_and_expiry(client):
    _request(client)
    for _ in range(5):
        assert client.post("/api/patient/otp/verify", json={"phone": "+77000000005", "code": "9999"}).status_code == 401
    locked = client.post("/api/patient/otp/verify", json={"phone": "+77000000005", "code": "0000"})
    assert locked.status_code == 429

    with connect() as conn:
        past = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        conn.execute("UPDATE otp_codes SET expires_at = ?, attempts = 0 WHERE phone = '+77000000005'", (past,))
        conn.commit()
    expired = client.post("/api/patient/otp/verify", json={"phone": "+77000000005", "code": "0000"})
    assert expired.status_code == 401 and expired.json()["error"]["code"] == "code_expired"


def test_otp_admin_number(client):
    _request(client, "+7 777 777 77 77")
    res = client.post("/api/patient/otp/verify", json={"phone": "+77777777777", "code": "0000"})
    assert res.status_code == 200 and res.json()["role"] == "admin"


def test_code_hash_not_plaintext(client):
    _request(client)
    with connect() as conn:
        row = conn.execute("SELECT code_hash FROM otp_codes WHERE phone = '+77000000005'").fetchone()
    assert row["code_hash"] != "0000" and len(row["code_hash"]) == 64
