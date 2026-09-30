ADMIN = {"X-Owner-Session": "demo-admin"}
COORD = {"X-Owner-Session": "demo-coordinator"}


def test_database_rows_and_role_columns(client):
    admin = client.get("/api/staff/database", headers=ADMIN).json()
    assert admin["medical_columns"] is True and admin["total"] >= 8
    row = next(r for r in admin["rows"] if r["case_id"] == "case-03")
    assert row["appointment_status"] == "demo_confirmed" and row["age"] == 44
    coord = client.get("/api/staff/database", headers=COORD).json()
    assert coord["medical_columns"] is False
    assert all("age" not in r and "factors" not in r for r in coord["rows"])
    assert client.get("/api/staff/database", headers={"X-Owner-Session": "owner-patient-01"}).status_code == 403
