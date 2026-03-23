"""Category CRUD endpoints."""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routes._helpers import ALL_ROLES, BUDGET_ROLES, require_role
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["categories"])


class CategoryIn(BaseModel):
    name: str


class CategoryOut(BaseModel):
    id: int
    name: str


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(_user: str = require_role(ALL_ROLES)):
    return queries.get_categories()


@router.post("/categories", status_code=201, response_model=CategoryOut)
def create_category(body: CategoryIn, _user: str = require_role(BUDGET_ROLES)):
    try:
        queries.add_category(body.name)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    cats = queries.get_categories()
    match = next((c for c in cats if c["name"] == body.name.strip()), None)
    return match


@router.delete("/categories/{category_id}")
def remove_category(category_id: int, _user: str = require_role(BUDGET_ROLES)):
    queries.delete_category(category_id)
    return {"ok": True}
