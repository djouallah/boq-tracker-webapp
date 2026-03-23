"""User role management endpoints (admin only)."""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routes._helpers import ADMIN_ROLES, require_role
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["roles"])


class RoleIn(BaseModel):
    username: str
    role: str


@router.get("/roles")
def list_roles(_user: str = require_role(ADMIN_ROLES)):
    return queries.get_all_roles()


@router.post("/roles", status_code=201)
def set_role(body: RoleIn, _user: str = require_role(ADMIN_ROLES)):
    try:
        queries.set_user_role(body.username, body.role)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True}


@router.delete("/roles/{username}")
def remove_role(username: str, _user: str = require_role(ADMIN_ROLES)):
    queries.delete_user_role(username)
    return {"ok": True}
