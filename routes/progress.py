"""Progress tracking endpoints."""
import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routes._helpers import ALL_ROLES, require_role, serialize
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["progress"])


class ProgressEntry(BaseModel):
    boq_item_id: int
    installed_quantity: float
    entry_date: str   # YYYY-MM-DD
    changed_by: str


@router.post("/progress")
def save_progress(entries: list[ProgressEntry], user: str = require_role(ALL_ROLES)):
    for e in entries:
        try:
            dt = date.fromisoformat(e.entry_date)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid date: {e.entry_date}")
        queries.add_progress_entry(
            e.boq_item_id, e.installed_quantity, dt, e.changed_by or user
        )
    return {"saved": len(entries)}


@router.get("/progress/{item_id}/history")
def get_history(item_id: int, _user: str = require_role(ALL_ROLES)):
    return serialize(queries.get_progress_history(item_id))
