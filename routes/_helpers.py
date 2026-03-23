"""Shared helpers used across route modules."""
import datetime
import json
import os
import pathlib
import time

from fastapi import Depends, HTTPException, Request

from utils import queries

_TOKEN_FILE = pathlib.Path(__file__).parent.parent / "db" / "pg_token.json"


def _user_from_token_file() -> str | None:
    """Return the signed-in Microsoft identity from the stored OAuth token, if valid."""
    try:
        if not _TOKEN_FILE.exists():
            return None
        data = json.loads(_TOKEN_FILE.read_text())
        obtained_at = data.get("obtained_at", 0)
        expires_in = data.get("expires_in", 3600)
        if time.time() > obtained_at + expires_in - 30:
            return None
        token = data.get("access_token", "")
        if not token:
            return None
        from db.connection import _username_from_token, friendly_email
        return friendly_email(_username_from_token(token))
    except Exception:
        return None


def detect_user(request: Request) -> str:
    for header in ("x-forwarded-email", "x-forwarded-user", "x-remote-user"):
        val = request.headers.get(header, "").strip()
        if val:
            return val
    token_user = _user_from_token_file()
    if token_user:
        return token_user
    local = os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"
    return f"{local}@local"


def require_role(allowed: list[str]):
    """FastAPI dependency factory. Returns the authenticated username if the
    user's role is in *allowed*, otherwise raises 403."""
    def _check(request: Request) -> str:
        user = detect_user(request)
        role = queries.get_user_role(user)
        if role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role: {' or '.join(allowed)}",
            )
        return user
    return Depends(_check)


# Convenience role sets
ALL_ROLES   = ["progress_entry", "budget", "admin"]
BUDGET_ROLES = ["budget", "admin"]
ADMIN_ROLES  = ["admin"]


def serialize(rows: list[dict]) -> list[dict]:
    """Convert date/datetime objects to ISO strings for JSON serialisation."""
    out = []
    for row in rows:
        r = {}
        for k, v in row.items():
            if isinstance(v, (datetime.date, datetime.datetime)):
                r[k] = v.isoformat()
            else:
                r[k] = v
        out.append(r)
    return out
