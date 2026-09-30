from __future__ import annotations

import json

from fastapi import APIRouter, Request

from app.contracts import CONTRACT_VERSION, ReviewBody
from app.db import audit, new_id, transaction
from app.errors import ApiError
from app.plans import load_journey_case
from app.sessions import STAFF_ROLES, Actor, current_actor, require_case

router = APIRouter()


def _require_case_read(conn, actor: Actor, case_id: str):
    if actor.role == "patient":
        return require_case(conn, actor, case_id, "patient_read")
    if actor.role in STAFF_ROLES:
        return require_case(conn, actor, case_id, "coordinator_read")
    raise ApiError(401, "session_required", "Нужна сессия")


def _serialize_observation(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "value": row["value"],
        "unit": row["unit"],
        "reference_range": row["reference_range"],
        "assertion": row["assertion"],
        "source_span": row["source_span"],
    }


def _serialize_report(conn, report) -> dict:
    observations = conn.execute(
        "SELECT * FROM observations WHERE report_id = ? ORDER BY id",
        (report["id"],),
    ).fetchall()
    return {
        "id": report["id"],
        "case_id": report["case_id"],
        "source_document_id": report["source_document_id"],
        "title": report["title"],
        "observed_on": report["observed_on"],
        "original_text": report["original_text"],
        "review_status": report["review_status"],
        "is_demo": bool(report["is_demo"]),
        "observations": [_serialize_observation(o) for o in observations],
    }


def _serialize_task(row) -> dict:
    return {
        "id": row["id"],
        "case_id": row["case_id"],
        "plan_id": row["plan_id"],
        "kind": row["kind"],
        "action": row["action"],
        "due_at": row["due_at"],
        "status": row["status"],
        "source": json.loads(row["source_json"] or "{}"),
        "completed_at": row["completed_at"],
    }


def _follow_up_exists(conn, case_id: str, action: str, source: dict) -> bool:
    rows = conn.execute(
        "SELECT source_json, action FROM tasks WHERE case_id = ? AND kind = 'follow_up'",
        (case_id,),
    ).fetchall()
    for row in rows:
        src = json.loads(row["source_json"] or "{}")
        if row["action"] == action and src.get("report_id") == source.get("report_id") and src.get("span") == source.get("span"):
            return True
    return False


@router.get("/api/cases/{case_id}/health-card")
def health_card(case_id: str, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        _require_case_read(conn, actor, case_id)

        reports = conn.execute(
            "SELECT * FROM reports WHERE case_id = ? ORDER BY observed_on, id",
            (case_id,),
        ).fetchall()
        tasks = conn.execute(
            "SELECT * FROM tasks WHERE case_id = ? ORDER BY kind, id",
            (case_id,),
        ).fetchall()
        return {
            "contract_version": CONTRACT_VERSION,
            "case_id": case_id,
            "is_demo": True,
            "reports": [_serialize_report(conn, r) for r in reports],
            "tasks": [
                {
                    "id": t["id"],
                    "kind": t["kind"],
                    "action": t["action"],
                    "due_at": t["due_at"],
                    "status": t["status"],
                }
                for t in tasks
            ],
        }


@router.post("/api/cases/{case_id}/results-review")
def results_review(case_id: str, body: ReviewBody, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        require_case(conn, actor, case_id, "doctor_write")

        rev = conn.execute(
            "SELECT id FROM questionnaire_revisions WHERE id = ? AND case_id = ?",
            (body.revision_id, case_id),
        ).fetchone()
        if rev is None:
            raise ApiError(422, "revision_invalid", "Ревизия анкеты не найдена для этой записи")

        reports = conn.execute("SELECT id FROM reports WHERE case_id = ?", (case_id,)).fetchall()
        for report in reports:
            conn.execute(
                "UPDATE reports SET review_status = ? WHERE id = ?",
                ("reviewed", report["id"]),
            )

        created: list[dict] = []
        journey = load_journey_case(case_id) or {}
        if journey.get("follow_up_action"):
            plan = conn.execute(
                "SELECT id FROM physician_plans WHERE case_id = ? ORDER BY id LIMIT 1",
                (case_id,),
            ).fetchone()
            plan_id = plan["id"] if plan else None
            for spec in (journey.get("follow_up_tasks") or [])[:2]:
                action = spec["action"]
                source = dict(spec.get("source") or {})
                source.setdefault("mode", "demo")
                due_at = spec.get("due_at")
                if _follow_up_exists(conn, case_id, action, source):
                    continue
                task_id = new_id("task")
                conn.execute(
                    """INSERT INTO tasks (id, case_id, plan_id, kind, action, due_at, status, source_json, completed_at)
                    VALUES (?,?,?,?,?,?,?,?,NULL)""",
                    (
                        task_id,
                        case_id,
                        plan_id,
                        "follow_up",
                        action,
                        due_at,
                        "active",
                        json.dumps(source, ensure_ascii=False),
                    ),
                )
                created.append(
                    {
                        "id": task_id,
                        "kind": "follow_up",
                        "action": action,
                        "due_at": due_at,
                        "status": "active",
                        "source": source,
                    }
                )

        conn.execute(
            "UPDATE cases SET stage = ? WHERE id = ?",
            ("follow_up_planned" if journey.get("follow_up_action") else "results_reviewed", case_id),
        )
        audit(
            conn,
            case_id,
            actor.token or "demo-doctor",
            "results_review",
            {"revision_id": body.revision_id, "tasks_created": [t["id"] for t in created]},
        )

        follow_ups = conn.execute(
            "SELECT * FROM tasks WHERE case_id = ? AND kind = 'follow_up' ORDER BY id",
            (case_id,),
        ).fetchall()
        return {
            "contract_version": CONTRACT_VERSION,
            "case_id": case_id,
            "review_status": "reviewed",
            "is_demo": True,
            "tasks_created": created,
            "tasks": [_serialize_task(t) for t in follow_ups],
        }
