import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PRIME_DB", str(tmp_path / "test.sqlite"))
    monkeypatch.setenv("PRIME_DEMO", "1")
    os.chdir(ROOT)
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def test_health_and_cards(client: TestClient):
    health = client.get("/api/health")
    assert health.status_code == 200
    body = health.json()
    assert body["status"] == "ok"
    assert body["model"] is None
    assert body["is_demo"] is True
    cards = client.get("/api/content/overview-cards")
    assert cards.status_code == 200
    assert len(cards.json()["cards"]) == 3
    patients = client.get("/api/staff/patients", headers={"X-Owner-Session": "demo-coordinator"})
    assert patients.status_code in {200, 501}
