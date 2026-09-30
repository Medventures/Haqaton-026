from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "data" / "fixtures"


def _seed_fixture_consents() -> None:
    from app.db import connect, new_id

    bundle = json.loads((FIXTURES / "backend_cases.json").read_text(encoding="utf-8"))
    with connect() as conn:
        for item in bundle.get("consents") or []:
            exists = conn.execute(
                "SELECT 1 FROM consents WHERE case_id = ? AND scope = ? LIMIT 1",
                (item["case_id"], item["scope"]),
            ).fetchone()
            if exists:
                continue
            conn.execute(
                """INSERT INTO consents (id, case_id, scope, text_version, granted, actor, granted_at)
                VALUES (?,?,?,?,?,?,datetime('now'))""",
                (
                    new_id("consent"),
                    item["case_id"],
                    item["scope"],
                    item["text_version"],
                    1 if item.get("granted") else 0,
                    item.get("actor"),
                ),
            )
        conn.commit()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PRIME_DB", str(tmp_path / "staff.sqlite"))
    monkeypatch.setenv("PRIME_DEMO", "1")
    os.chdir(ROOT)
    from app.main import app

    with TestClient(app) as test_client:
        _seed_fixture_consents()
        yield test_client
