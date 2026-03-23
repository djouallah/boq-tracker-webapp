"""Application settings via Pydantic BaseSettings."""
import logging
import pathlib

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

_REPO_ROOT = pathlib.Path(__file__).parent.parent


class Settings(BaseSettings):
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:3000",
        description="Comma-separated allowed CORS origins",
    )
    log_level: str = Field(default="INFO")

    model_config = {
        "env_file": str(_REPO_ROOT / ".env"),
        "case_sensitive": False,
        "extra": "allow",
    }


settings = Settings()


def get_settings() -> Settings:
    """FastAPI dependency — returns the singleton settings instance."""
    return settings
