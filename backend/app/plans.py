from __future__ import annotations

import json

from fastapi import APIRouter, Request

from app.contracts import CONTRACT_VERSION, PlanBody
from app.db import FIXTURES, audit, new_id, transaction
from app.errors import ApiError
from app.sessions import STAFF_ROLES, Actor, current_actor, require_case

router = APIRouter()

PLAN_TEMPLATES: dict[str, dict] = {
    "demo-plan-basic": {
        "services": ["therapist_visit", "demo_lab", "demo_ultrasound"],
        "source_refs": ["fixture:demo-plan-basic"],
    }
}

PREP_TEMPLATES = [
    {
        "template_id": "demo-prep-meds",
        "action": "Уточнить с врачом вопрос о регулярных лекарствах. Дозу не менять самостоятельно.",
        "due_at": None,
    },
    {
        "template_id": "demo-prep-documents",
        "action": "Взять документ, удостоверяющий личность, и список текущих жалоб.",
        "due_at": None,
    },
    {
        "template_id": "demo-prep-lab",
        "action": "Уточнить с врачом, нужна ли подготовка перед лабораторным исследованием. Срок и правила не выдумывать самостоятельно.",
        "due_at": None,
    },
    {
        "template_id": "demo-prep-arrival",
        "action": "Подтвердить время прибытия в клинику с координатором.",
        "due_at": None,
    },
]


def _require_case_read(conn, actor: Actor, case_id: str):
    if actor.role == "patient":
        return require_case(conn, actor, case_id, "patient_read")
    if actor.role in STAFF_ROLES:
        return require_case(conn, actor, case_id, "coordinator_read")
    raise ApiError(401, "session_required", "Нужна сессия")


def _plan_row(conn, case_id: str):
    return conn.execute(
        "SELECT * FROM physician_plans WHERE case_id = ? ORDER BY approved_at DESC, id ASC LIMIT 1",
        (case_id,),
    ).fetchone()


def _serialize_plan(row) -> dict:
    return {
        "id": row["id"],
        "case_id": row["case_id"],
        "revision_id": row["revision_id"],
        "author_doctor_id": row["author_doctor_id"],
        "template_id": row["template_id"],
        "source_refs": json.loads(row["source_refs_json"] or "[]"),
        "services": json.loads(row["services_json"] or "[]"),
        "status": row["status"],
        "approval_status": row["approval_status"],
        "mode": row["mode"],
        "approved_at": row["approved_at"],
        "is_demo": bool(row["is_demo"]),
        "contract_version": CONTRACT_VERSION,
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


def _ensure_preparation_tasks(conn, case_id: str, plan_id: str) -> list:
    rows = conn.execute(
        "SELECT * FROM tasks WHERE case_id = ? AND kind = 'preparation' ORDER BY id",
        (case_id,),
    ).fetchall()
    if len(rows) >= 3:
        return list(rows)
    existing_actions = {r["action"] for r in rows}
    for template in PREP_TEMPLATES:
        if len(rows) >= 4:
            break
        if template["action"] in existing_actions:
            continue
        task_id = new_id("task")
        source = {
            "template_id": template["template_id"],
            "mode": "demo",
            "protocol_version": "demo-prep-v1",
        }
        conn.execute(
            """INSERT INTO tasks (id, case_id, plan_id, kind, action, due_at, status, source_json, completed_at)
            VALUES (?,?,?,?,?,?,?,?,NULL)""",
            (
                task_id,
                case_id,
                plan_id,
                "preparation",
                template["action"],
                template["due_at"],
                "active",
                json.dumps(source, ensure_ascii=False),
            ),
        )
        rows = conn.execute(
            "SELECT * FROM tasks WHERE case_id = ? AND kind = 'preparation' ORDER BY id",
            (case_id,),
        ).fetchall()
        existing_actions = {r["action"] for r in rows}
    return list(rows)


@router.post("/api/cases/{case_id}/physician-plan")
def create_physician_plan(case_id: str, body: PlanBody, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        require_case(conn, actor, case_id, "doctor_write")
        existing = _plan_row(conn, case_id)
        if existing is not None:
            return _serialize_plan(existing)

        rev = conn.execute(
            "SELECT id FROM questionnaire_revisions WHERE id = ? AND case_id = ?",
            (body.revision_id, case_id),
        ).fetchone()
        if rev is None:
            raise ApiError(422, "revision_invalid", "Ревизия анкеты не найдена для этой записи")

        template = PLAN_TEMPLATES.get(body.template_id)
        if template is None:
            raise ApiError(422, "template_invalid", "Неизвестный шаблон плана", {"template_id": "unknown"})

        plan_id = new_id("plan")
        conn.execute(
            """INSERT INTO physician_plans (
                id, case_id, revision_id, author_doctor_id, template_id, source_refs_json, services_json,
                status, approval_status, mode, approved_at, is_demo
            ) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),1)""",
            (
                plan_id,
                case_id,
                body.revision_id,
                "demo-doctor",
                body.template_id,
                json.dumps(template["source_refs"], ensure_ascii=False),
                json.dumps(template["services"], ensure_ascii=False),
                "confirmed",
                "unapproved",
                "demo",
            ),
        )
        conn.execute(
            "UPDATE cases SET stage = ? WHERE id = ?",
            ("physician_plan_confirmed", case_id),
        )
        audit(
            conn,
            case_id,
            actor.token or "demo-doctor",
            "physician_plan_confirmed",
            {"plan_id": plan_id, "template_id": body.template_id, "revision_id": body.revision_id},
        )
        row = conn.execute("SELECT * FROM physician_plans WHERE id = ?", (plan_id,)).fetchone()
        return _serialize_plan(row)


@router.get("/api/cases/{case_id}/preparation")
def get_preparation(case_id: str, request: Request) -> dict:
    with transaction() as conn:
        actor = current_actor(conn, request)
        _require_case_read(conn, actor, case_id)
        plan = _plan_row(conn, case_id)
        if plan is None:
            raise ApiError(409, "plan_not_approved", "Сначала врач должен подтвердить демо-план")
        tasks = _ensure_preparation_tasks(conn, case_id, plan["id"])
        return {
            "contract_version": CONTRACT_VERSION,
            "case_id": case_id,
            "plan_id": plan["id"],
            "is_demo": True,
            "completion_is_clinical_clearance": False,
            "tasks": [_serialize_task(t) for t in tasks],
        }


def load_journey_case(case_id: str) -> dict | None:
    path = FIXTURES / "journey_cases.json"
    if not path.exists():
        return None
    for item in json.loads(path.read_text(encoding="utf-8")):
        if item.get("case_id") == case_id:
            return item
    return None
