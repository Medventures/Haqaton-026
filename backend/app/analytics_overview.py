"""Business dashboard for the clinic workspace: KPIs, funnel, programmes, factors, per-question stats.

Privacy: aggregated counts only. Answer distributions come from saved questionnaires of
clients who booked (anonymous previews are never stored); question drop-off comes from
anonymous events that carry only the question id.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request

from app.analytics import funnel
from app.availability import CLINIC_TZ, parse_utc, slot_is_busy
from app.db import DATA, connect
from app.errors import ApiError
from app.sessions import STAFF_ROLES, current_actor

router = APIRouter()

STAGE_LABELS = {
    "questionnaire_saved": "Анкета",
    "package_selected": "Программа выбрана",
    "therapist_booking_requested": "Заявка на приём",
    "therapist_booking_confirmed": "Записан к терапевту",
    "consultation_completed": "Приём прошёл",
    "physician_plan_confirmed": "План врача",
    "preparation_in_progress": "Подготовка",
    "results_available": "Результаты",
    "follow_up_planned": "Повторы",
}
AGE_GROUPS = [("18–29", 18, 29), ("30–39", 30, 39), ("40", 40, 40), ("41–54", 41, 54), ("55+", 55, 200)]
FUNNEL_STEPS = [
    ("sessions", "Зашли на сайт"),
    ("intake_started", "Начали анкету"),
    ("intake_submitted", "Прошли анкету"),
    ("recommendations_viewed", "Увидели программы"),
    ("booking_opened", "Открыли запись"),
    ("appointment_confirmed", "Записались"),
]


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def build_overview(conn, now: datetime | None = None) -> dict[str, Any]:
    from app.rules import classify
    from app.tiers import build_offer, fired_rules

    now = now or datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
    questionnaire = json.loads((DATA / "questionnaire.json").read_text(encoding="utf-8"))
    catalogue = json.loads((DATA / "catalogue.real.json").read_text(encoding="utf-8"))
    rules = json.loads((DATA / "explanations.json").read_text(encoding="utf-8"))["rules"]
    rule_titles = {r["id"]: r["title_ru"] for r in rules}
    program_names = {p["package_id"]: p["name"] for p in catalogue["packages"]}

    cases = conn.execute(
        """SELECT c.id, c.stage, c.selected_program_id, c.created_at, c.language, r.answers_json
           FROM cases c LEFT JOIN questionnaire_revisions r ON r.id = c.current_revision_id"""
    ).fetchall()
    prices = {p["package_id"]: p.get("price_minor") for p in catalogue["packages"] if isinstance(p.get("price_minor"), int)}
    answers_list = [json.loads(c["answers_json"]) for c in cases if c["answers_json"]]

    # --- funnel (sessions) ---
    f = funnel(conn, None, None)
    sessions = int(conn.execute("SELECT COUNT(*) AS n FROM analytics_sessions").fetchone()["n"])
    counts = {"sessions": sessions, **f["counts"]}
    funnel_steps = [{"key": k, "label": label, "count": counts.get(k, 0)} for k, label in FUNNEL_STEPS]

    # --- appointments & capacity ---
    appts = conn.execute(
        """SELECT a.status, s.starts_at FROM appointments a JOIN slots s ON s.id = a.slot_id
           WHERE a.status != 'cancelled'"""
    ).fetchall()
    upcoming_7 = sum(1 for a in appts if now <= parse_utc(a["starts_at"]) < now + timedelta(days=7))
    by_day: Counter[str] = Counter(
        parse_utc(a["starts_at"]).astimezone(CLINIC_TZ).date().isoformat()
        for a in appts
        if now <= parse_utc(a["starts_at"]) < now + timedelta(days=31)
    )
    horizon = [r for r in conn.execute("SELECT id, starts_at, blocked FROM slots").fetchall()
               if now <= parse_utc(r["starts_at"]) < now + timedelta(days=14)]
    busy = sum(1 for r in horizon if slot_is_busy(conn, r["id"], r["blocked"]))
    pending = sum(1 for a in appts if a["status"] == "clinic_request_pending")

    # --- demographics, programmes, tiers, factors ---
    sex = Counter(a.get("exam_applicability") for a in answers_list)
    ages = [a.get("age_years") for a in answers_list if isinstance(a.get("age_years"), int)]
    age_groups = [{"label": label, "count": sum(1 for x in ages if lo <= x <= hi)} for label, lo, hi in AGE_GROUPS]
    programs = Counter(c["selected_program_id"] for c in cases if c["selected_program_id"])
    tiers: Counter[str] = Counter()
    factors: Counter[str] = Counter()
    for a in answers_list:
        try:
            offer = build_offer(a, classify(a))
        except Exception:  # malformed legacy fixture answers
            offer = None
        tiers[(offer.recommended if offer else None) or ("none" if offer is None else "discuss")] += 1
        for r in fired_rules(a):
            factors[r["id"]] += 1

    # --- per-question: views / answered (events) + option distribution (saved answers) ---
    q_events = conn.execute(
        """SELECT name, props_json, COUNT(DISTINCT analytics_session_id) AS n FROM analytics_events
           WHERE name IN ('question_viewed','question_answered') GROUP BY name, props_json"""
    ).fetchall()
    views: Counter[str] = Counter()
    answered: Counter[str] = Counter()
    for row in q_events:
        qid = (json.loads(row["props_json"] or "{}") or {}).get("question_id")
        if not qid:
            continue
        (views if row["name"] == "question_viewed" else answered)[qid] += int(row["n"])

    questions = []
    for q in questionnaire["questions"]:
        given = [a[q["id"]] for a in answers_list if q["id"] in a]
        options = []
        if q["answer_type"] == "number":
            options = [{"code": g["label"], "label": g["label"], "count": g["count"]} for g in age_groups]
        else:
            tally: Counter[str] = Counter()
            for v in given:
                for code in v if isinstance(v, list) else [v]:
                    tally[code] += 1
            options = [
                {"code": o["code"], "label": o["label"], "count": tally.get(o["code"], 0)}
                for o in q.get("options") or []
            ]
        total = len(given)
        for o in options:
            o["share"] = _rate(o["count"], total)
        v, ans = views.get(q["id"], 0), answered.get(q["id"], 0)
        questions.append(
            {
                "id": q["id"],
                "label": q["label"],
                "type": q["answer_type"],
                "respondents": total,
                "views": v,
                "answered": ans,
                "drop_off": _rate(v - ans, v) if v else None,
                "options": options,
            }
        )

    # --- money: pipeline by stage, average check, revenue by programme ---
    booked_stages = {"therapist_booking_confirmed", "consultation_completed", "physician_plan_confirmed",
                     "preparation_in_progress", "results_available", "follow_up_planned"}
    done_stages = {"physician_plan_confirmed", "preparation_in_progress", "results_available", "follow_up_planned"}
    def value(rows) -> int:
        return sum(prices.get(c["selected_program_id"], 0) for c in rows)
    priced = [c for c in cases if c["selected_program_id"] in prices]
    booked_rows = [c for c in priced if c["stage"] in booked_stages]
    revenue = {
        "pipeline": value(priced),
        "booked": value(booked_rows),
        "realised": value([c for c in priced if c["stage"] in done_stages]),
        "avg_check": round(value(priced) / len(priced)) if priced else None,
        "by_program": sorted(
            [{"package_id": k, "name": program_names.get(k, k), "count": v, "amount": v * prices.get(k, 0)}
             for k, v in Counter(c["selected_program_id"] for c in priced).items()],
            key=lambda x: -x["amount"],
        ),
        "currency": "KZT",
    }

    # --- conversion by segment: share of clients who reached a booked stage ---
    def seg_rate(rows) -> dict[str, Any]:
        n = len(rows)
        b = sum(1 for c in rows if c["stage"] in booked_stages)
        return {"clients": n, "booked": b, "rate": _rate(b, n)}
    with_answers = [(c, json.loads(c["answers_json"])) for c in cases if c["answers_json"]]
    segments = {
        "age": [{"label": label, **seg_rate([c for c, a in with_answers if isinstance(a.get("age_years"), int) and lo <= a["age_years"] <= hi])}
                for label, lo, hi in AGE_GROUPS],
        "sex": [{"label": lbl, **seg_rate([c for c, a in with_answers if a.get("exam_applicability") == key])}
                for key, lbl in (("male", "Мужчины"), ("female", "Женщины"), ("discuss", "Не указали"))],
        "reason": [{"label": lbl, **seg_rate([c for c, a in with_answers if a.get("visit_reason") == key])}
                   for key, lbl in (("prevention", "Проверить здоровье"), ("complaints", "Есть жалобы"),
                                    ("follow_up", "Контроль по назначению"), ("employer", "Для работы"))],
    }

    # --- booked-slot heatmap: weekday × hour (Almaty) ---
    heat: Counter[tuple[int, int]] = Counter()
    for a in appts:
        local = parse_utc(a["starts_at"]).astimezone(CLINIC_TZ)
        heat[(local.weekday(), local.hour)] += 1
    heatmap = [{"weekday": d, "hour": h, "count": heat.get((d, h), 0)} for d in range(5) for h in range(9, 18)]

    # --- new clients per week + language share ---
    weeks: Counter[str] = Counter()
    for c in cases:
        try:
            day = datetime.fromisoformat(str(c["created_at"]).replace(" ", "T")[:19])
        except ValueError:
            continue
        monday = (day - timedelta(days=day.weekday())).date().isoformat()
        weeks[monday] += 1
    lang = Counter("kz" if (c["language"] or "ru") in {"kk", "kz"} else "ru" for c in cases)

    submitted = counts.get("intake_submitted", 0)
    confirmed = counts.get("appointment_confirmed", 0)
    started = counts.get("intake_started", 0)
    return {
        "generated_at": now.isoformat(),
        "kpis": {
            "clients": len(cases),
            "sessions": sessions,
            "completion_rate": _rate(submitted, started),
            "booking_rate": _rate(confirmed, submitted),
            "visit_conversion": _rate(confirmed, sessions),
            "appointments": len(appts),
            "pending_requests": pending,
            "upcoming_7d": upcoming_7,
            "utilisation_14d": _rate(busy, len(horizon)),
            "avg_age": round(sum(ages) / len(ages), 1) if ages else None,
            "maximum_share": _rate(tiers.get("maximum", 0), sum(tiers.values())),
        },
        "funnel": funnel_steps,
        "stages": [{"stage": s, "label": label, "count": sum(1 for c in cases if c["stage"] == s)} for s, label in STAGE_LABELS.items()],
        "programs": [{"package_id": k, "name": program_names.get(k, "Программа к обсуждению"), "count": v} for k, v in programs.most_common()],
        "tiers": [
            {"key": "optimal", "label": "Оптимальный", "count": tiers.get("optimal", 0)},
            {"key": "maximum", "label": "Максимальный", "count": tiers.get("maximum", 0)},
            {"key": "discuss", "label": "Выбор с терапевтом", "count": tiers.get("discuss", 0)},
            {"key": "none", "label": "Без предложения", "count": tiers.get("none", 0)},
        ],
        "factors": [{"id": k, "label": rule_titles.get(k, k), "count": v} for k, v in factors.most_common(10)],
        "sex": [
            {"key": "male", "label": "Мужчины", "count": sex.get("male", 0)},
            {"key": "female", "label": "Женщины", "count": sex.get("female", 0)},
            {"key": "discuss", "label": "Не указали", "count": sex.get("discuss", 0)},
        ],
        "age_groups": age_groups,
        "bookings_by_day": [{"date": d, "count": n} for d, n in sorted(by_day.items())],
        "questions": questions,
        "revenue": revenue,
        "segments": segments,
        "heatmap": heatmap,
        "weekly_clients": [{"week": w, "count": n} for w, n in sorted(weeks.items())],
        "languages": [{"key": "ru", "label": "Русский", "count": lang.get("ru", 0)},
                      {"key": "kz", "label": "Қазақша", "count": lang.get("kz", 0)}],
        "note": "Ответы — по сохранённым анкетам записавшихся; отвал по вопросам — по анонимным сессиям без ответов.",
        "is_demo": True,
    }


@router.get("/api/staff/analytics/overview")
def analytics_overview(request: Request) -> dict:
    with connect() as conn:
        actor = current_actor(conn, request)
        if actor.role not in STAFF_ROLES:
            raise ApiError(403, "forbidden", "Аналитика доступна сотрудникам")
        return build_overview(conn)
