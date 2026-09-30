"""One-time SMS codes for patient login.

- 4-digit code, stored only as a salted SHA-256 hash, valid 5 minutes
- resend cooldown 60 s, max 5 sends per phone per hour, max 5 wrong attempts per code
- provider chosen by SMS_PROVIDER: "log" (default; prints nothing sensitive, demo code 0000
  in PRIME_DEMO mode) or "mobizon" / "smsc" adapters that need API keys in env (not bundled)
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from app.errors import ApiError
from app.sessions import demo_enabled

log = logging.getLogger("otp")

TTL = timedelta(minutes=5)
COOLDOWN = timedelta(seconds=60)
HOURLY_LIMIT = 5
MAX_ATTEMPTS = 5
DEMO_CODE = "0000"

SCHEMA = """
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  sends_in_window INTEGER NOT NULL DEFAULT 0
);
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(code: str, salt: str) -> str:
    pepper = os.environ.get("OTP_PEPPER", "green-clinic-dev-pepper")
    return hashlib.sha256(f"{pepper}:{salt}:{code}".encode()).hexdigest()


def _send_sms(phone: str, text: str) -> None:
    provider = os.environ.get("SMS_PROVIDER", "log")
    if provider == "log":
        # Never log the code itself.
        log.info("SMS to %s***%s queued (log provider)", phone[:4], phone[-2:])
        return
    raise ApiError(503, "sms_unavailable", "Отправка СМС временно недоступна")


def request_code(conn: sqlite3.Connection, phone: str) -> dict:
    conn.executescript(SCHEMA)
    now = _now()
    row = conn.execute("SELECT * FROM otp_codes WHERE phone = ?", (phone,)).fetchone()
    window_start, sends = now, 0
    if row:
        last = datetime.fromisoformat(row["last_sent_at"])
        if now - last < COOLDOWN:
            wait = int((COOLDOWN - (now - last)).total_seconds()) + 1
            raise ApiError(429, "otp_cooldown", f"Новый код можно запросить через {wait} с", {"retry_after": str(wait)})
        window_start = datetime.fromisoformat(row["window_start"])
        sends = int(row["sends_in_window"])
        if now - window_start > timedelta(hours=1):
            window_start, sends = now, 0
        if sends >= HOURLY_LIMIT:
            raise ApiError(429, "otp_limit", "Слишком много запросов кода. Попробуйте через час")

    code = DEMO_CODE if demo_enabled() else f"{secrets.randbelow(10_000):04d}"
    salt = secrets.token_hex(8)
    conn.execute(
        """INSERT INTO otp_codes (phone, code_hash, salt, expires_at, attempts, last_sent_at, window_start, sends_in_window)
           VALUES (?,?,?,?,0,?,?,?)
           ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, salt=excluded.salt,
             expires_at=excluded.expires_at, attempts=0, last_sent_at=excluded.last_sent_at,
             window_start=excluded.window_start, sends_in_window=excluded.sends_in_window""",
        (phone, _hash(code, salt), salt, (now + TTL).isoformat(), now.isoformat(), window_start.isoformat(), sends + 1),
    )
    _send_sms(phone, f"Green Clinic: код для входа {code}. Никому не сообщайте его.")
    return {"sent": True, "retry_after": int(COOLDOWN.total_seconds()), "expires_in": int(TTL.total_seconds())}


def verify_code(conn: sqlite3.Connection, phone: str, code: str) -> None:
    conn.executescript(SCHEMA)
    row = conn.execute("SELECT * FROM otp_codes WHERE phone = ?", (phone,)).fetchone()
    if row is None or datetime.fromisoformat(row["expires_at"]) < _now():
        raise ApiError(401, "code_expired", "Код устарел. Запросите новый", {"code": "expired"})
    if int(row["attempts"]) >= MAX_ATTEMPTS:
        raise ApiError(429, "otp_attempts", "Слишком много попыток. Запросите новый код", {"code": "locked"})
    if not hmac.compare_digest(_hash(code, row["salt"]), row["code_hash"]):
        conn.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?", (phone,))
        conn.commit()
        raise ApiError(401, "code_invalid", "Неверный код", {"code": "invalid"})
    conn.execute("DELETE FROM otp_codes WHERE phone = ?", (phone,))
