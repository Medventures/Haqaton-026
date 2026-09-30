import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PRIME_DB", str(tmp_path / "plans_results.sqlite"))
    monkeypatch.setenv("PRIME_DEMO", "1")
    os.chdir(ROOT)
    from app.db import init_db
    from app.main import app

    init_db()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def doctor_headers():
    return {"X-Owner-Session": "demo-doctor"}


@pytest.fixture()
def coordinator_headers():
    return {"X-Owner-Session": "demo-coordinator"}


@pytest.fixture()
def patient_headers():
    def _headers(n: int) -> dict[str, str]:
        return {"X-Owner-Session": f"owner-patient-{n:02d}"}

    return _headers
