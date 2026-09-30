from __future__ import annotations

import json

from fastapi import APIRouter

from app.contracts import CATALOGUE_VERSION, CONTENT_VERSION, CONTRACT_VERSION, QUESTIONNAIRE_VERSION, RULES_VERSION
from app.db import DATA

router = APIRouter()


def _read(name: str) -> dict | list:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@router.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "contract_version": CONTRACT_VERSION,
        "questionnaire_version": QUESTIONNAIRE_VERSION,
        "catalogue_version": CATALOGUE_VERSION,
        "rules_version": RULES_VERSION,
        "content_version": CONTENT_VERSION,
        "is_demo": True,
        "model": None,
    }


@router.get("/api/content/overview-cards")
def overview_cards() -> dict:
    payload = _read("educational_cards.json")
    return {"contract_version": CONTRACT_VERSION, "content_version": CONTENT_VERSION, "is_demo": True, **payload}


@router.get("/api/config/questionnaire")
def questionnaire() -> dict:
    return _read("questionnaire.json")


@router.get("/api/config/clinic")
def clinic() -> dict:
    return _read("clinic.json")
