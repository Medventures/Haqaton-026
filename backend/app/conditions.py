"""Declarative conditions shared by the questionnaire (show_if / required_if) and explanation rules.

Grammar (JSON):
  {"id": "field", "eq": v}            value == v
  {"id": "field", "in": [..]}         scalar value in list, or list value intersects list
  {"id": "field", "lte"|"gte"|"lt"|"gt": n}   numeric comparison (missing/non-number → False)
  {"id": "field", "exists": true}     answered (non-empty)
  {"all": [cond, ...]}  /  {"any": [cond, ...]}  /  {"not": cond}
"""

from __future__ import annotations

from typing import Any

_NUMERIC = {"lte", "gte", "lt", "gt"}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def condition_met(condition: dict[str, Any] | None, answers: dict[str, Any]) -> bool:
    if not condition:
        return True
    if "all" in condition:
        return all(condition_met(c, answers) for c in condition["all"])
    if "any" in condition:
        return any(condition_met(c, answers) for c in condition["any"])
    if "not" in condition:
        return not condition_met(condition["not"], answers)

    value = answers.get(condition["id"])
    if "eq" in condition:
        return value == condition["eq"]
    if "in" in condition:
        allowed = condition["in"]
        if isinstance(value, list):
            return any(item in allowed for item in value)
        return value in allowed
    if "exists" in condition:
        present = value not in (None, "", [])
        return present if condition["exists"] else not present
    for op in _NUMERIC:
        if op in condition:
            if not _is_number(value):
                return False
            bound = condition[op]
            return {
                "lte": value <= bound,
                "gte": value >= bound,
                "lt": value < bound,
                "gt": value > bound,
            }[op]
    return False
