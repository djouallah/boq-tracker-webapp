"""Routes package — aggregates all domain routers into a single api_router."""
from fastapi import APIRouter

from routes.healthcheck import router as healthcheck_router
from routes.db_config import router as db_config_router
from routes.auth import router as auth_router
from routes.user import router as user_router
from routes.categories import router as categories_router
from routes.boq_items import router as boq_items_router
from routes.dashboard import router as dashboard_router
from routes.progress import router as progress_router
from routes.audit import router as audit_router
from routes.imports import router as imports_router
from routes.roles import router as roles_router

api_router = APIRouter()
api_router.include_router(healthcheck_router)
api_router.include_router(db_config_router)
api_router.include_router(auth_router)
api_router.include_router(user_router)
api_router.include_router(roles_router)
api_router.include_router(categories_router)
api_router.include_router(boq_items_router)
api_router.include_router(dashboard_router)
api_router.include_router(progress_router)
api_router.include_router(audit_router)
api_router.include_router(imports_router)
