import pytest

from app.sessions import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("+7 700 000 00 05", "+77000000005"),
        ("87000000005", "+77000000005"),
        ("7000000005", "+77000000005"),
        ("+7 (700) 000-00-05", "+77000000005"),
        ("123", None),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_login_ok_returns_owner_token_and_cookie(client):
    res = client.post("/api/patient/login", json={"phone": "8 700 000 00 05", "code": "0000"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token"].startswith("login-")
    assert body["role"] == "patient"
    assert body["patient_id"] == "patient-05"
    assert body["is_demo"] is True
    assert "prime_owner" in res.cookies


def test_login_wrong_code(client):
    res = client.post("/api/patient/login", json={"phone": "+77000000005", "code": "1234"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "code_invalid"


def test_login_unknown_phone(client):
    res = client.post("/api/patient/login", json={"phone": "+77009999999", "code": "0000"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "patient_not_found"


def test_login_invalid_phone(client):
    res = client.post("/api/patient/login", json={"phone": "12345", "code": "0000"})
    assert res.status_code == 422


def test_me_requires_patient_session(client):
    assert client.get("/api/patient/me").status_code == 401
    staff = client.get("/api/patient/me", headers={"X-Owner-Session": "demo-doctor"})
    assert staff.status_code == 401


def test_me_returns_only_own_cases(client):
    res = client.get("/api/patient/me", headers={"X-Owner-Session": "owner-patient-03"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["patient_id"] == "patient-03"
    assert [c["case_id"] for c in body["cases"]] == ["case-03"]
    case = body["cases"][0]
    assert case["stage"] == "therapist_booking_confirmed"
    assert case["appointment_status"] == "demo_confirmed"
    assert case["booked_starts_at"]
    assert case["step_index"] == 2
    assert "questionnaire" not in case


def test_login_disabled_without_demo(client, monkeypatch):
    monkeypatch.setenv("PRIME_DEMO", "0")
    res = client.post("/api/patient/login", json={"phone": "+77000000005", "code": "0000"})
    assert res.status_code == 404


def test_admin_phone_opens_workspace(client):
    res = client.post("/api/patient/login", json={"phone": "+7 (777) 777-77-77", "code": "0000"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["role"] == "admin" and body["token"] == "demo-admin"
    assert client.get("/api/staff/patients", headers={"X-Owner-Session": body["token"]}).status_code == 200


def _new_case(client, phone, name="Тест Тестов"):
    sub = {
        "contract_version": "v4",
        "revision_id": "r-new",
        "questionnaire_version": "demo-intake-v1",
        "processing_consent": {"granted": True, "text_version": "demo-processing-v1"},
        "answers": {"age_years": 35, "exam_applicability": "male", "visit_reason": "prevention", "symptoms": ["none"],
                    "conditions": ["none"], "medicines": "no", "family": ["none"], "tobacco": "never", "prior_results": "no"},
        "doctor_note": None,
        "clinic_transfer": {"granted": True, "text_version": "demo-transfer-v1"},
        "contact_name": name,
        "phone": phone,
    }
    res = client.post("/api/cases", json=sub)
    assert res.status_code == 200, res.text
    return res.json()


def test_booking_phone_normalized_and_login_merges_cases(client):
    first = _new_case(client, "8 (701) 555-44-33")
    second = _new_case(client, "+7 701 555 44 33")
    # Booking tokens are scoped to their own new record only.
    me_first = client.get("/api/patient/me", headers={"X-Owner-Session": first["owner_session"]}).json()
    assert [c["case_id"] for c in me_first["cases"]] == [first["case_id"]]
    assert me_first["phone"] == "+77015554433"
    # Code login with the same phone sees both bookings.
    login = client.post("/api/patient/login", json={"phone": "87015554433", "code": "0000"}).json()
    me = client.get("/api/patient/me", headers={"X-Owner-Session": login["token"]}).json()
    assert {c["case_id"] for c in me["cases"]} == {first["case_id"], second["case_id"]}
    assert client.get(f"/api/cases/{second['case_id']}/health-card", headers={"X-Owner-Session": login["token"]}).status_code == 200


def test_booking_token_cannot_read_other_record_with_same_phone(client):
    # Someone booking with another person's number must not see that person's seeded case.
    stranger = _new_case(client, "+77000000005", name="Чужой")
    res = client.get("/api/cases/case-05/health-card", headers={"X-Owner-Session": stranger["owner_session"]})
    assert res.status_code == 404
    me = client.get("/api/patient/me", headers={"X-Owner-Session": stranger["owner_session"]}).json()
    assert [c["case_id"] for c in me["cases"]] == [stranger["case_id"]]


def test_create_case_rejects_bad_phone(client):
    sub_phone = "12"
    try:
        _new_case(client, sub_phone)
    except AssertionError:
        return
    raise AssertionError("expected 422")
