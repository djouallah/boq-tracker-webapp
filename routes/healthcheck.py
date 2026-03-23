"""Health check endpoint."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    timestamp: str


@router.get("/healthcheck", response_model=HealthResponse)
async def healthcheck():
    logger.debug("Health check requested")
    return {"status": "OK", "timestamp": datetime.now(timezone.utc).isoformat()}
