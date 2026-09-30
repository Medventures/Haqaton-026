"""Synthetic population for the default demo database: clients, answers, bookings, sessions.

Makes the clinic dashboards meaningful on a fresh install. All rows are synthetic
(`syn-` ids, is_demo=1) and are only created for the default demo DB (not for tests that
point PRIME_DB at a temp file) unless PRIME_SYNTHETIC=1 is set explicitly.
"""

from __future__ import annotations

import json
import os
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from app.db import new_id

FIRST_F = ["Айгерим", "Мадина", "Дана", "Асель", "Камила", "Жанар", "Гульнара", "Алина", "Сауле", "Индира", "Ольга", "Елена"]
FIRST_M = ["Арман", "Нурлан", "Данияр", "Ержан", "Тимур", "Алихан", "Бауыржан", "Руслан", "Азамат", "Сергей", "Максим", "Олжас"]
LAST_M = ["Сейткали", "Абдрахманов", "Турсынов", "Муканов", "Ким", "Иванов", "Жаксылыков", "Оспанов", "Кенжебеков", "Нуртаев", "Смагулов", "Ли"]
LAST_F = ["Сейткали", "Абдрахманова", "Турсынова", "Муканова", "Ким", "Иванова", "Жаксылыкова", "Оспанова", "Кенжебекова", "Нуртаева", "Смагулова", "Ли"]

STAGES = [
    ("questionnaire_saved", 7),
    ("package_selected", 6),
    ("therapist_booking_requested", 4),
    ("therapist_booking_confirmed", 12),
    ("consultation_completed", 5),
    ("physician_plan_confirmed", 4),
    ("preparation_in_progress", 4),
    ("results_available", 4),
    ("follow_up_planned", 3),
]
BOOKED = {
    "therapist_booking_confirmed",
    "consultation_completed",
    "physician_plan_confirmed",
    "preparation_in_progress",
    "results_available",
    "follow_up_planned",
}

QUESTION_ORDER = [
    "age_years", "exam_applicability", "pregnancy", "visit_reason", "complaint_topic", "symptoms",
    "conditions", "medicines", "medicine_groups", "family", "tobacco", "prior_results", "result_types",
]


def synthetic_enabled() -> bool:
    flag = os.environ.get("PRIME_SYNTHETIC")
    if flag is not None:
        return flag == "1"
    return os.environ.get("PRIME_DB") is None


def _answers(rng: random.Random) -> dict:
    sex = rng.choices(["male", "female", "discuss"], [46, 50, 4])[0]
    age = rng.choice([rng.randint(22, 39), rng.randint(22, 39), 40, rng.randint(41, 55), rng.randint(41, 68)])
    a: dict = {"age_years": age, "exam_applicability": sex}
    if sex in {"female", "discuss"} and 18 <= age <= 55:
        a["pregnancy"] = rng.choices(["no", "yes", "unknown", "not_applicable"], [90, 3, 3, 4])[0]
    a["visit_reason"] = rng.choices(["prevention", "complaints", "follow_up", "employer"], [58, 24, 10, 8])[0]
    if a["visit_reason"] == "complaints":
        a["complaint_topic"] = rng.choice(["heart", "breathing", "digestion", "urinary", "general", "general", "unsure"])
    a["symptoms"] = rng.choices([["none"], ["unsure"], ["other"]], [85, 8, 7])[0]
    cond = rng.choices(
        [["none"], ["blood_pressure"], ["diabetes"], ["thyroid"], ["digestive"], ["blood_pressure", "heart"], ["unknown"], ["lungs"], ["kidneys"]],
        [52, 14, 6, 7, 6, 4, 6, 3, 2],
    )[0]
    a["conditions"] = cond
    a["medicines"] = "yes" if cond not in (["none"], ["unknown"]) and rng.random() < 0.7 else rng.choices(["no", "unknown", "yes"], [80, 8, 12])[0]
    if a["medicines"] == "yes":
        a["medicine_groups"] = rng.choice([["pressure"], ["glucose"], ["hormones"], ["other"], ["unknown"], ["pressure", "cholesterol"]])
    a["family"] = rng.choices([["none"], ["heart"], ["diabetes"], ["cancer"], ["unknown"], ["heart", "diabetes"]], [34, 22, 12, 14, 12, 6])[0]
    a["tobacco"] = rng.choices(
        ["never", "former_cigarettes", "current_cigarettes", "vape", "other_tobacco", "declined"], [52, 16, 14, 12, 2, 4]
    )[0]
    a["prior_results"] = rng.choices(["yes", "no", "unknown"], [38, 50, 12])[0]
    if a["prior_results"] == "yes":
        a["result_types"] = rng.choice([["labs"], ["labs", "ultrasound"], ["ct_mri"], ["endoscopy"], ["labs", "date_unknown"]])
    return a


def ensure_synthetic_population(conn: sqlite3.Connection, n_clients: int = 49, n_sessions: int = 180) -> None:
    if conn.execute("SELECT 1 FROM patients WHERE id LIKE 'syn-%' LIMIT 1").fetchone():
        return
    from app.rules import classify
    from app.tiers import build_offer

    rng = random.Random(20260930)
    base = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    stage_pool = [s for s, w in STAGES for _ in range(w)]
    free_slots = [
        r["id"]
        for r in conn.execute(
            """SELECT s.id FROM slots s LEFT JOIN appointments a ON a.slot_id = s.id AND a.status != 'cancelled'
               WHERE s.blocked = 0 AND a.id IS NULL AND s.id LIKE 'gen-slot-%' ORDER BY s.starts_at"""
        )
    ]
    rng.shuffle(free_slots)

    for i in range(n_clients):
        answers = _answers(rng)
        female = answers["exam_applicability"] == "female" or (answers["exam_applicability"] == "discuss" and rng.random() < 0.5)
        name = f"{rng.choice(FIRST_F if female else FIRST_M)} {rng.choice(LAST_F if female else LAST_M)}"
        pid, cid, rid = f"syn-patient-{i:02d}", f"syn-case-{i:02d}", f"syn-rev-{i:02d}"
        created = (base + timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 9))).strftime("%Y-%m-%d %H:%M:%S")
        stage = stage_pool[i % len(stage_pool)] if i < len(stage_pool) else rng.choice(stage_pool)
        offer = build_offer(answers, classify(answers))
        program = None
        if offer and offer.groups and stage != "questionnaire_saved":
            tier = offer.recommended or "optimal"
            program = getattr(offer.groups[0], tier).package_id
        conn.execute(
            "INSERT INTO patients (id, display_name, contact_name, phone, language, is_demo) VALUES (?,?,?,?,?,1)",
            (pid, name, name, f"+7701{rng.randint(1000000, 9999999)}", rng.choices(["ru", "kk"], [80, 20])[0]),
        )
        conn.execute("INSERT INTO owner_sessions (token, patient_id, created_at) VALUES (?,?,?)", (f"syn-owner-{i:02d}", pid, created))
        conn.execute(
            """INSERT INTO cases (id, patient_id, stage, current_revision_id, selected_program_id, consultation_reason,
               requested_services_json, requested_changes_json, preferred_date, notes, owner_id, language, is_demo, created_at)
               VALUES (?,?,?,?,?,?,'[]','[]',?,NULL,'demo-coordinator','ru',1,?)""",
            (
                cid, pid, stage, rid, program,
                "discuss_preliminary_programme" if offer and offer.cta == "discuss" else "check_programme",
                f"2026-10-{rng.randint(1, 30):02d}", created,
            ),
        )
        conn.execute(
            """INSERT INTO questionnaire_revisions (id, case_id, kind, answers_json, doctor_note, active_fields_json, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (rid, cid, "intake", json.dumps(answers, ensure_ascii=False), None, json.dumps(list(answers), ensure_ascii=False), created),
        )
        for scope, version in (("processing", "demo-processing-v1"), ("clinic_transfer", "demo-transfer-v1")):
            conn.execute(
                "INSERT INTO consents (id, case_id, scope, text_version, granted, actor, granted_at) VALUES (?,?,?,?,1,?,?)",
                (new_id("consent"), cid, scope, version, pid, created),
            )
        if (stage in BOOKED or stage == "therapist_booking_requested") and free_slots:
            status = "clinic_request_pending" if stage == "therapist_booking_requested" else "demo_confirmed"
            conn.execute(
                """INSERT INTO appointments (id, case_id, slot_id, status, consultation_reason, revision_id, idempotency_key,
                   payload_fingerprint, requested_at, confirmed_at, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,1)""",
                (f"syn-appt-{i:02d}", cid, free_slots.pop(), status, "check_programme", rid, f"syn-{i}", "syn", created,
                 created if status == "demo_confirmed" else None),
            )

    # Anonymous sessions: funnel + per-question views (question ids only, never answers).
    for s in range(n_sessions):
        sid = f"syn-session-{s:03d}"
        t = base + timedelta(days=rng.randint(0, 29), minutes=rng.randint(0, 600))
        conn.execute("INSERT OR IGNORE INTO analytics_sessions (id, started_at, last_seen_at) VALUES (?,?,?)",
                     (sid, t.isoformat(), t.isoformat()))

        def ev(name: str, props: dict | None = None, source: str = "client") -> None:
            nonlocal t
            t += timedelta(seconds=rng.randint(4, 40))
            conn.execute(
                """INSERT INTO analytics_events (event_id, analytics_session_id, name, occurred_at, props_json, event_source, operation_key)
                   VALUES (?,?,?,?,?,?,?)""",
                (new_id("aev"), sid, name, t.isoformat(), json.dumps(props or {}), source,
                 f"{sid}:{name}" if source == "server" else None),
            )

        ev("session_started")
        ev("page_viewed", {"screen_id": "home"})
        if rng.random() > 0.72:
            continue
        ev("intake_started")
        answers = _answers(rng)
        visible = [q for q in QUESTION_ORDER if q in answers]
        quit_at = len(visible) if rng.random() < 0.78 else rng.randint(1, len(visible) - 1)
        for q in visible[:quit_at]:
            ev("question_viewed", {"question_id": q})
            ev("question_answered", {"question_id": q})
        if quit_at < len(visible):
            ev("question_viewed", {"question_id": visible[quit_at]})
            continue
        ev("intake_submitted")
        ev("recommendations_viewed")
        if rng.random() < 0.62:
            ev("cta_clicked", {"cta": rng.choices(["optimal", "maximum"], [64, 36])[0]})
            ev("booking_opened")
            if rng.random() < 0.7:
                ev("appointment_requested", source="server")
                ev("appointment_confirmed", source="server")
    conn.commit()
