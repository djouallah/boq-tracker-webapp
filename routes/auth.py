"""Microsoft interactive browser sign-in for PostgreSQL authentication.

POST /api/auth/login   — opens the system browser with an account picker,
                         blocks until the user picks their account.
GET  /api/auth/status  — check if a valid token is stored.
DELETE /api/auth/token — sign out.
"""
import asyncio
import json
import logging
import pathlib
import time

from fastapi import APIRouter, HTTPException

import db.connection as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

_TOKEN_FILE = pathlib.Path(__file__).parent.parent / "db" / "pg_token.json"


@router.post("/login")
async def login():
    """Open the Microsoft account picker and save the chosen account's token."""
    from azure.identity import InteractiveBrowserCredential

    cfg = db.load_db_config()
    tenant_id = cfg.get("tenant_id", "").strip() or "common"

    def _do_login():
        credential = InteractiveBrowserCredential(tenant_id=tenant_id)
        token_resp = credential.get_token(
            "https://ossrdbms-aad.database.windows.net/.default"
        )
        token = token_resp.token
        user = db.friendly_email(db._username_from_token(token))
        expires_in = max(int(token_resp.expires_on - time.time()), 300)
        data = {
            "access_token": token,
            "obtained_at": time.time(),
            "expires_in": expires_in,
        }
        _TOKEN_FILE.write_text(json.dumps(data, indent=2))
        db.get_engine.cache_clear()
        logger.info("Interactive login succeeded: %s", user)
        return user

    loop = asyncio.get_event_loop()
    try:
        user = await asyncio.wait_for(
            loop.run_in_executor(None, _do_login),
            timeout=300.0,
        )
        return {"ok": True, "user": user}
    except asyncio.TimeoutError:
        raise HTTPException(408, "Login timed out — please try again.")
    except Exception as e:
        raise HTTPException(500, f"Login failed: {e}")


@router.get("/status")
def auth_status():
    if not _TOKEN_FILE.exists():
        return {"authenticated": False, "user": None, "expired": False}
    try:
        data = json.loads(_TOKEN_FILE.read_text())
        token = data.get("access_token", "")
        user = db.friendly_email(db._username_from_token(token)) if token else None
        obtained_at = data.get("obtained_at", 0)
        expires_in = data.get("expires_in", 3600)
        expired = time.time() > obtained_at + expires_in - 30
        return {"authenticated": not expired, "user": user, "expired": expired}
    except Exception as e:
        return {"authenticated": False, "user": None, "error": str(e)}


@router.delete("/token")
def clear_token():
    if _TOKEN_FILE.exists():
        _TOKEN_FILE.unlink()
    db.get_engine.cache_clear()
    return {"ok": True}
