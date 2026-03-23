"""Dashboard endpoint."""
import logging

from fastapi import APIRouter, Query

from routes._helpers import ALL_ROLES, require_role, serialize
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["dashboard"])

PAGE_SIZE = 100


@router.get("/dashboard")
def get_dashboard(
    page: int = Query(1, ge=1),
    category: str = Query(""),
    search: str = Query(""),
    progress_only: bool = Query(False),
    _user: str = require_role(ALL_ROLES),
):
    offset = (page - 1) * PAGE_SIZE
    rows = queries.get_dashboard_rows(
        limit=PAGE_SIZE,
        offset=offset,
        category=category,
        search=search,
        progress_only=progress_only,
    )
    total = queries.count_dashboard_rows(
        category=category,
        search=search,
        progress_only=progress_only,
    )
    return {
        "rows": serialize(rows),
        "total": total,
        "page": page,
        "page_size": PAGE_SIZE,
    }
