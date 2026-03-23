"""Global exception handlers for the BOQ Tracker API."""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from errors.exceptions import BaseAppException

logger = logging.getLogger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BaseAppException)
    async def handle_app_exception(request: Request, exc: BaseAppException):
        logger.error("Application error [%s]: %s", exc.status_code, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": True, "message": exc.message, "details": exc.details},
        )

    @app.exception_handler(PydanticValidationError)
    async def handle_pydantic_validation_error(request: Request, exc: PydanticValidationError):
        logger.warning("Validation error: %s", exc)
        return JSONResponse(
            status_code=400,
            content={
                "error": True,
                "message": "Validation error",
                "details": {"issues": exc.errors()},
            },
        )

    @app.exception_handler(Exception)
    async def handle_unhandled_exception(request: Request, exc: Exception):
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"error": True, "message": "An unexpected error occurred", "details": {}},
        )
