"""Two-tier offer (Optimal | Maximum) built only from clinic catalogue packages.

Rules (demo, unapproved — see .agent/PLAN_V7.md §Rules):
  sex  female/male → own packages; discuss → both groups (UI toggle)
  age  18–39 → optimal = basic-u40,    maximum = extended-40p (by agreement with doctor)
       40    → optimal = basic-u40,    maximum = extended-40p, no recommendation (boundary)
       41+   → optimal = extended-40p, maximum = extended-40p "adapted": same package +
               discussion topics derived from answers (no invented tests or prices)
  recommended = "maximum" when a fired rule marked tier=maximum touches blocks that only
               the maximum tier has (or, for 41+, any adaptation topic); else "optimal".
  cta = "discuss" for clinician-review / pregnancy workflows and age 40, else "book".
No offer for safety_stop / adult_scope_excluded.
"""

from __future__ import annotations

import json
from typing import Any

from app.conditions import condition_met
from app.contracts import (
    ComparisonRow,
    Explanation,
    Offer,
    OfferTier,
    TierGroup,
    WorkflowClass,
)
from app.db import DATA
from app.rules import Classification

_CACHE: dict[str, Any] | None = None
_CATALOGUE: dict[str, Any] | None = None

SEX_PREFIX = {"female": "w", "male": "m"}

# 41+ "adapted" maximum: discussion topics (not tests) triggered by explanation rules.
ADAPTATION_TOPICS: dict[str, tuple[str, str]] = {
    "family_cancer": ("Расширенный онкоскрининг с учётом семейной истории", "Отбасылық тарихты ескеріп кеңейтілген онкоскрининг"),
    "heart": ("Консультация кардиолога по результатам ЭКГ и ЭхоКГ", "ЭКГ мен ЭхоКГ нәтижелері бойынша кардиолог кеңесі"),
    "digestion": ("Консультация гастроэнтеролога", "Гастроэнтеролог кеңесі"),
    "diabetes": ("Консультация эндокринолога", "Эндокринолог кеңесі"),
    "smoker": ("Консультация пульмонолога", "Пульмонолог кеңесі"),
    "urinary": ("Расширенное обследование почек и мочевых путей", "Бүйрек пен несеп жолдарын кеңейтілген тексеру"),
    "lungs": ("Консультация пульмонолога", "Пульмонолог кеңесі"),
    "kidneys": ("УЗИ почек и консультация нефролога", "Бүйрек УДЗ және нефролог кеңесі"),
    "thyroid": ("УЗИ щитовидной железы и консультация эндокринолога", "Қалқанша без УДЗ және эндокринолог кеңесі"),
    "prior_results": ("Сверка с вашими прошлыми результатами", "Бұрынғы нәтижелеріңізбен салыстыру"),
}
ADAPTATION_DEFAULT = ("Программа адаптируется под ваши пожелания на приёме", "Бағдарлама қабылдауда тілегіңізге қарай бейімделеді")


def _data() -> dict[str, Any]:
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads((DATA / "explanations.json").read_text(encoding="utf-8"))
    return _CACHE


def _catalogue() -> dict[str, dict[str, Any]]:
    global _CATALOGUE
    if _CATALOGUE is None:
        raw = json.loads((DATA / "catalogue.real.json").read_text(encoding="utf-8"))
        _CATALOGUE = {p["package_id"]: p for p in raw.get("packages") or []}
    return _CATALOGUE


def _blocks(package: dict[str, Any]) -> list[str]:
    return [b["id"] for b in package.get("blocks") or [] if isinstance(b, dict) and b.get("id")]


def fired_rules(answers: dict[str, Any]) -> list[dict[str, Any]]:
    rules = [r for r in _data()["rules"] if condition_met(r.get("when"), answers)]
    return sorted(rules, key=lambda r: -int(r.get("priority", 0)))


def explanations(answers: dict[str, Any], limit: int = 4) -> list[Explanation]:
    out: list[Explanation] = []
    for rule in fired_rules(answers)[:limit]:
        out.append(
            Explanation(
                id=rule["id"],
                title_ru=rule["title_ru"],
                text_ru=rule["text_ru"],
                title_kz=rule.get("title_kz"),
                text_kz=rule.get("text_kz"),
                blocks=list(rule.get("blocks") or []),
                tier=rule.get("tier"),
            )
        )
    return out


def _tier(
    slot: str,
    package: dict[str, Any],
    *,
    optimal_blocks: list[str],
    variant: str = "standard",
    note: tuple[str, str] | None = None,
    adaptation: list[tuple[str, str]] | None = None,
) -> OfferTier:
    blocks = _blocks(package)
    extra = [b for b in blocks if b not in optimal_blocks] if slot == "maximum" else []
    return OfferTier(
        slot=slot,  # type: ignore[arg-type]
        package_id=package["package_id"],
        name=package["name"],
        name_kz=package.get("name_kz"),
        variant=variant,  # type: ignore[arg-type]
        block_ids=blocks,
        extra_block_ids=extra,
        price_minor=package.get("price_minor") if isinstance(package.get("price_minor"), int) else None,
        currency=package.get("currency"),
        source_url=package.get("source_url"),
        note_ru=note[0] if note else None,
        note_kz=note[1] if note else None,
        adaptation_ru=[a[0] for a in adaptation or []],
        adaptation_kz=[a[1] for a in adaptation or []],
        details=[
            {
                "id": b["id"],
                "label": b.get("label") or b["id"],
                # Full clinic wording exists only in Russian; Kazakh gets the block title.
                "label_kz": (_data()["block_labels"].get(b["id"]) or {}).get("kz"),
            }
            for b in package.get("blocks") or []
            if isinstance(b, dict) and b.get("id")
        ],
        price_old_minor=package.get("price_old_minor") if isinstance(package.get("price_old_minor"), int) else None,
    )


def _group(sex: str, age: int, fired_ids: list[str]) -> TierGroup | None:
    prefix = SEX_PREFIX[sex]
    catalogue = _catalogue()
    basic = catalogue.get(f"{prefix}-basic-u40")
    extended = catalogue.get(f"{prefix}-extended-40p")
    if not basic or not extended:
        return None

    labels = _data()["block_labels"]
    if age >= 41:
        topics = [ADAPTATION_TOPICS[i] for i in fired_ids if i in ADAPTATION_TOPICS] or [ADAPTATION_DEFAULT]
        optimal = _tier("optimal", extended, optimal_blocks=[])
        maximum = _tier(
            "maximum",
            extended,
            optimal_blocks=_blocks(extended),
            variant="adapted",
            note=("Та же программа, дополненная под ваши ответы. Состав и стоимость — на приёме.",
                  "Сол бағдарлама, жауаптарыңызға қарай толықтырылған. Құрамы мен құны — қабылдауда."),
            adaptation=topics,
        )
    else:
        optimal = _tier(
            "optimal",
            basic,
            optimal_blocks=[],
            note=("Граница возраста — выберем с терапевтом.", "Жас шекарасы — терапевтпен таңдаймыз.") if age == 40 else None,
        )
        maximum = _tier(
            "maximum",
            extended,
            optimal_blocks=_blocks(basic),
            note=("Выберем с терапевтом." , "Терапевтпен таңдаймыз.") if age == 40 else (
                "Рассчитана на возраст после 40 — по согласованию с врачом.",
                "40-тан кейінгі жасқа арналған — дәрігермен келісіп.",
            ),
        )

    union = list(dict.fromkeys(maximum.block_ids + optimal.block_ids))
    rows = [
        ComparisonRow(
            block_id=b,
            label_ru=(labels.get(b) or {}).get("ru", b),
            label_kz=(labels.get(b) or {}).get("kz", b),
            optimal=b in optimal.block_ids,
            maximum=b in maximum.block_ids,
        )
        for b in union
    ]
    return TierGroup(sex=sex, optimal=optimal, maximum=maximum, comparison=rows)  # type: ignore[arg-type]


def build_offer(answers: dict[str, Any], classification: Classification) -> Offer | None:
    if not classification.allow_candidates:
        return None
    age = answers.get("age_years")
    if not isinstance(age, int) or age < 18:
        return None

    exam = answers.get("exam_applicability")
    sexes = ["female", "male"] if exam not in SEX_PREFIX else [exam]
    fired = fired_rules(answers)
    fired_ids = [r["id"] for r in fired]
    groups = [g for g in (_group(s, age, fired_ids) for s in sexes) if g]
    if not groups:
        return None

    # Recommendation: does any "maximum" rule touch blocks only the maximum tier has?
    recommended: str | None = "optimal"
    rec_ru = "Покрывает то, что важно по вашим ответам, без лишнего."
    rec_kz = "Жауаптарыңыз бойынша маңыздысын артығынсыз қамтиды."
    extra = set().union(*(set(g.maximum.extra_block_ids) for g in groups))
    max_rules = [r for r in fired if r.get("tier") == "maximum" and set(r.get("blocks") or []) & extra]
    if age >= 41 and any(i in ADAPTATION_TOPICS for i in fired_ids):
        recommended = "maximum"
        rec_ru = "Ваши ответы стоит обсудить подробнее — программа дополнится под вас."
        rec_kz = "Жауаптарыңызды толығырақ талқылаған жөн — бағдарлама сізге қарай толықтырылады."
    elif max_rules:
        recommended = "maximum"
        rec_ru = f"По ответам («{max_rules[0]['title_ru']}») есть исследования, которые входят только в расширенную."
        rec_kz = f"Жауаптар бойынша («{max_rules[0].get('title_kz') or max_rules[0]['title_ru']}») тек кеңейтілгенде бар зерттеулер бар."
    if age == 40:
        recommended = None
        rec_ru = "Вам 40 — граница программ. Выберем вместе с терапевтом."
        rec_kz = "Сізге 40 — бағдарламалар шекарасы. Терапевтпен бірге таңдаймыз."

    discuss = classification.workflow_class in {
        WorkflowClass.needs_clinician_review,
        WorkflowClass.pregnancy_review,
    } or age == 40

    return Offer(
        groups=groups,
        recommended=recommended,  # type: ignore[arg-type]
        recommendation_ru=rec_ru,
        recommendation_kz=rec_kz,
        cta="discuss" if discuss else "book",
        explanations=explanations(answers),
        factors=fired_ids,
        rules_version=_data().get("version", "demo"),
    )
