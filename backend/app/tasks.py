from __future__ import annotations

import json

from fastapi import APIRouter, Request

from app.contracts import CONTRACT_VERSION, TaskPatch
from app.db import audit, transaction
from app.errors import ApiError
from app.sessions import current_actor, require_case

router = APIRouter()


@router.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, body: TaskPatch, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if task is None:
            raise ApiError(404, "not_found", "Задача не найдена")

        # Ownership via case; foreign case looks like missing task for patients.
        require_case(conn, actor, task["case_id"], "patient_task")

        if task["kind"] != "preparation":
            raise ApiError(403, "forbidden", "Пациент может завершать только задачи подготовки")

        completed_at = None
        if body.status == "completed":
            completed_at = conn.execute("SELECT datetime('now') AS t").fetchone()["t"]
        elif body.status == "active":
            completed_at = None
        else:
            completed_at = task["completed_at"]

        conn.execute(
            "UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?",
            (body.status, completed_at, task_id),
        )
        audit(
            conn,
            task["case_id"],
            actor.token or "patient",
            "task_status_changed",
            {
                "task_id": task_id,
                "status": body.status,
                "clinical_clearance": False,
            },
        )
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return {
            "contract_version": CONTRACT_VERSION,
            "id": row["id"],
            "case_id": row["case_id"],
            "plan_id": row["plan_id"],
            "kind": row["kind"],
            "action": row["action"],
            "due_at": row["due_at"],
            "status": row["status"],
            "source": json.loads(row["source_json"] or "{}"),
            "completed_at": row["completed_at"],
            "clinical_clearance": False,
            "is_demo": True,
        }
