"""Audit log endpoint."""
import logging

from fastapi import APIRouter

from routes._helpers import BUDGET_ROLES, require_role, serialize
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit-log")
def get_audit_log(limit: int = 100, _user: str = require_role(BUDGET_ROLES)):
    return serialize(queries.get_audit_log(limit))
