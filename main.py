"""
BOQ Tracker — FastAPI backend.

Development:
    uvicorn main:app --reload --port 8000

Production:
    uvicorn main:app --host 0.0.0.0 --port 8080
"""
import asyncio
import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config.settings import settings
from errors.handlers import register_exception_handlers
from routes import api_router
import db.connection as db

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _periodic_health_check(interval: int = 300):
    """Background task: verify DB connectivity every `interval` seconds."""
    from sqlalchemy import text as sa_text
    while True:
        await asyncio.sleep(interval)
        try:
            engine = db.get_engine()
            with engine.connect() as conn:
                conn.execute(sa_text("SELECT 1"))
            logger.info("DB health check: OK")
        except Exception as exc:
            logger.warning("DB health check: FAILED — %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initialise DB engine and launch background health monitor.
    Shutdown: cancel the health-check task cleanly."""
    logger.info("Application startup initiated")
    health_task = None
    try:
        db.get_engine()
        health_task = asyncio.create_task(_periodic_health_check(300))
        logger.info("Database initialised; health monitoring started (interval=300s)")
    except Exception as exc:
        logger.error("Database initialisation failed at startup: %s", exc)
        logger.info("Application will start — DB routes will fail until the engine is (re-)configured")

    logger.info("Application startup complete")
    yield

    logger.info("Application shutdown initiated")
    if health_task:
        health_task.cancel()
        try:
            await health_task
        except asyncio.CancelledError:
            logger.info("Health check task cancelled")
    logger.info("Application shutdown complete")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="BOQ Tracker API",
    version="1.0.0",
    lifespan=lifespan,
)

register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# ── SPA static file serving (production only) ─────────────────────────────────

_DIST = pathlib.Path(__file__).parent / "frontend" / "dist"
if _DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(_DIST / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return FileResponse(str(_DIST / "index.html"))
