from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "data" / "fixtures" / "matching_cases.json"


@pytest.fixture()
def matching_fixtures() -> dict:
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PRIME_DB", str(tmp_path / "rules_matching.sqlite"))
    monkeypatch.setenv("PRIME_DEMO", "1")
    os.chdir(ROOT)
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
