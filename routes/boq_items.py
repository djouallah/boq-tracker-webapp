"""BOQ item CRUD endpoints."""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routes._helpers import BUDGET_ROLES, require_role
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["boq-items"])


class BoqItemIn(BaseModel):
    category_id: int
    code: str
    description: str
    unit: str
    budget_quantity: float


class BoqItemUpdate(BaseModel):
    category_id: int
    description: str
    unit: str
    budget_quantity: float


@router.get("/boq-items")
def list_boq_items(_user: str = require_role(BUDGET_ROLES)):
    return queries.get_boq_items()


@router.post("/boq-items", status_code=201)
def create_boq_item(body: BoqItemIn, _user: str = require_role(BUDGET_ROLES)):
    try:
        queries.add_boq_item(
            body.category_id, body.code, body.description, body.unit, body.budget_quantity
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True}


@router.put("/boq-items/{item_id}")
def update_boq_item(item_id: int, body: BoqItemUpdate, _user: str = require_role(BUDGET_ROLES)):
    queries.update_boq_item(
        item_id, body.category_id, body.description, body.unit, body.budget_quantity
    )
    return {"ok": True}


@router.delete("/boq-items/{item_id}")
def remove_boq_item(item_id: int, _user: str = require_role(BUDGET_ROLES)):
    queries.delete_boq_item(item_id)
    return {"ok": True}
