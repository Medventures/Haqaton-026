from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.db import connect
from app.errors import ApiError

router = APIRouter()

CLINIC_TZ = ZoneInfo("Asia/Almaty")


def parse_utc(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def slot_matches_date(starts_at: str, date: str) -> bool:
    dt = parse_utc(starts_at)
    utc_date = dt.date().isoformat()
    local_date = dt.astimezone(CLINIC_TZ).date().isoformat()
    return date == utc_date or date == local_date


def slot_is_busy(conn, slot_id: str, blocked: int) -> bool:
    if blocked:
        return True
    live = conn.execute(
        """SELECT 1 FROM appointments
        WHERE slot_id = ? AND status != 'cancelled' LIMIT 1""",
        (slot_id,),
    ).fetchone()
    return live is not None


@router.get("/api/therapists/{therapist_id}/availability/month")
def get_month_availability(therapist_id: str, month: str = Query(..., pattern=r"^\d{4}-\d{2}$")) -> dict:
    """Per-day counts for the calendar grid; no slot or patient details."""
    with connect() as conn:
        therapist = conn.execute("SELECT id FROM therapists WHERE id = ?", (therapist_id,)).fetchone()
        if therapist is None:
            raise ApiError(404, "not_found", "Терапевт не найден")
        rows = conn.execute(
            "SELECT id, starts_at, blocked FROM slots WHERE therapist_id = ? ORDER BY starts_at",
            (therapist_id,),
        ).fetchall()
        days: dict[str, dict[str, int]] = {}
        for row in rows:
            local = parse_utc(row["starts_at"]).astimezone(CLINIC_TZ).date().isoformat()
            if not local.startswith(month):
                continue
            bucket = days.setdefault(local, {"available": 0, "busy": 0})
            if slot_is_busy(conn, row["id"], row["blocked"]):
                bucket["busy"] += 1
            else:
                bucket["available"] += 1
        return {
            "month": month,
            "timezone": "Asia/Almaty",
            "days": [{"date": d, **counts} for d, counts in sorted(days.items())],
            "is_demo": True,
        }


@router.get("/api/therapists/{therapist_id}/availability")
def get_availability(therapist_id: str, date: str = Query(...)) -> dict:
    with connect() as conn:
        therapist = conn.execute(
            "SELECT id, display_name, is_demo, timezone FROM therapists WHERE id = ?",
            (therapist_id,),
        ).fetchone()
        if therapist is None:
            raise ApiError(404, "not_found", "Терапевт не найден")
        rows = conn.execute(
            """SELECT id, therapist_id, starts_at, ends_at, blocked
            FROM slots WHERE therapist_id = ? ORDER BY starts_at""",
            (therapist_id,),
        ).fetchall()
        slots = []
        for row in rows:
            if not slot_matches_date(row["starts_at"], date):
                continue
            busy = slot_is_busy(conn, row["id"], row["blocked"])
            slots.append(
                {
                    "id": row["id"],
                    "therapist_id": row["therapist_id"],
                    "starts_at": row["starts_at"],
                    "ends_at": row["ends_at"],
                    "availability": "busy" if busy else "available",
                }
            )
        return {
            "slots": slots,
            "therapist": {
                "id": therapist["id"],
                "display_name": therapist["display_name"],
                "is_demo": True,
            },
            "timezone": therapist["timezone"] or "Asia/Almaty",
        }
