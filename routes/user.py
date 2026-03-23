"""User identity endpoint."""
import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from routes._helpers import detect_user
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["user"])


class UserResponse(BaseModel):
    user: str
    role: Optional[str]


@router.get("/me", response_model=UserResponse)
def get_user(request: Request):
    user = detect_user(request)
    try:
        role = queries.get_user_role(user)
    except Exception:
        role = None
    return {"user": user, "role": role}
