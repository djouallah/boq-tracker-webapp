import functools
import json
import logging
import pathlib
import time
from sqlalchemy import create_engine, text

from errors.exceptions import ConfigurationError, DatabaseError

logger = logging.getLogger(__name__)

_REPO_ROOT = pathlib.Path(__file__).parent.parent
_DB_CONFIG_PATH = pathlib.Path(__file__).parent / "config.json"
_TOKEN_FILE = pathlib.Path(__file__).parent / "pg_token.json"

_AZURE_PG_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


def load_db_config() -> dict:
    if _DB_CONFIG_PATH.exists():
        try:
            return json.loads(_DB_CONFIG_PATH.read_text())
        except Exception:
            pass
    return {"backend": "sqlite"}


def save_db_config(config: dict):
    _DB_CONFIG_PATH.write_text(json.dumps(config, indent=2))


def get_backend() -> str:
    return load_db_config().get("backend", "sqlite")


def is_local() -> bool:
    """Return True when running against a local SQLite database."""
    return get_backend() == "sqlite"


def _get_pg_config() -> tuple[str, str, str]:
    """Returns (host, database, pg_user). Raises ConfigurationError if host not set."""
    cfg = load_db_config()
    host = cfg.get("pg_host", "").strip()
    if not host:
        raise ConfigurationError(
            "PostgreSQL server not configured. Enter the server hostname in the Database Configuration."
        )
    database = cfg.get("pg_database", "postgres").strip() or "postgres"
    pg_user = cfg.get("pg_user", "").strip()
    return host, database, pg_user


def _username_from_token(token: str) -> str:
    """Decode an Azure AD JWT and return the identity name (no signature verification needed)."""
    import base64, json
    payload = token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    claims = json.loads(base64.b64decode(payload))
    # users → upn/unique_name; managed identity / service principal → unique_name or appid
    return claims.get("upn") or claims.get("unique_name") or claims.get("appid", "")


def friendly_email(upn: str) -> str:
    """Convert an EXT UPN back to the original email.
    mdjouallah_microsoft.com#EXT#@tenant → mdjouallah@microsoft.com
    Regular UPNs are returned as-is.
    """
    if '#EXT#' not in upn:
        return upn
    ext_part = upn.split('#EXT#')[0]
    last_underscore = ext_part.rfind('_')
    if last_underscore == -1:
        return upn
    return ext_part[:last_underscore] + '@' + ext_part[last_underscore + 1:]


def _load_oauth_token() -> str | None:
    """Return the interactively obtained access token if still valid."""
    if not _TOKEN_FILE.exists():
        return None
    try:
        data = json.loads(_TOKEN_FILE.read_text())
        obtained_at = data.get("obtained_at", 0)
        expires_in = data.get("expires_in", 3600)
        if time.time() < obtained_at + expires_in - 60:
            return data["access_token"]
    except Exception as e:
        logger.warning("DB: OAuth token load failed: %s", e)
    return None


def _make_pg_creator(host: str, database: str, pg_user: str = ""):
    """Returns a psycopg2 connection factory that acquires a fresh Azure AD token each call.

    Prefers an interactively obtained OAuth token (from /api/auth/login) so the user
    can pick any of their Microsoft accounts. Falls back to DefaultAzureCredential.

    If pg_user is given it is used as the PostgreSQL username; otherwise the username
    is derived automatically from the token claims (upn / unique_name / appid).
    """
    import psycopg2

    def creator():
        # 1. Prefer interactively obtained OAuth token (user picked their account)
        token = _load_oauth_token()
        if token:
            user = pg_user or _username_from_token(token)
            logger.debug("DB: connecting as %s (OAuth interactive token)", user)
            return psycopg2.connect(
                host=host, dbname=database, user=user,
                password=token, sslmode="require",
            )

        # 2. Fall back to environment credential (managed identity, Azure CLI, etc.)
        from azure.identity import DefaultAzureCredential
        cfg = load_db_config()
        tenant_id = cfg.get("tenant_id", "").strip() or None
        credential = DefaultAzureCredential(
            additionally_allowed_tenants=[tenant_id] if tenant_id else [],
        )
        token = credential.get_token(_AZURE_PG_SCOPE).token
        user = pg_user or _username_from_token(token)
        if not user:
            raise ConfigurationError(
                "Could not determine Azure AD identity. "
                "Use the 'Sign in with Microsoft' button to authenticate."
            )
        logger.debug("DB: connecting as %s (DefaultAzureCredential)", user)
        return psycopg2.connect(
            host=host, dbname=database, user=user,
            password=token, sslmode="require",
        )

    return creator


@functools.lru_cache(maxsize=1)
def get_engine():
    cfg = load_db_config()
    backend = cfg.get("backend", "sqlite")

    if backend == "sqlite":
        db_path = cfg.get("sqlite_path", "data/boq_tracker.db")
        if not pathlib.Path(db_path).is_absolute():
            db_path = str(_REPO_ROOT / db_path)
        engine = create_engine(f"sqlite:///{db_path}")
        schema_file = "schema_sqlite.sql"
        logger.info("DB: connecting to SQLite at %s", db_path)
    else:
        try:
            host, database, pg_user = _get_pg_config()
        except ConfigurationError:
            raise
        except Exception as e:
            raise DatabaseError(f"Failed to configure PostgreSQL connection: {e}") from e
        creator = _make_pg_creator(host, database, pg_user)
        logger.info("DB: connecting to PostgreSQL at %s/%s (Azure AD)", host, database)
        engine = create_engine(
            "postgresql+psycopg2://",
            creator=creator,
            pool_pre_ping=True,
        )
        schema_file = "schema.sql"

    schema = (pathlib.Path(__file__).parent / schema_file).read_text()
    try:
        with engine.begin() as conn:
            for stmt in schema.split(";"):
                stmt = stmt.strip()
                if stmt:
                    conn.execute(text(stmt))
        logger.info("DB: schema initialised (%s)", backend)
    except Exception as e:
        err_str = str(e)
        if "permission denied" in err_str.lower() or "insufficient_privilege" in err_str.lower():
            # Non-admin user — schema already exists, skip init and continue
            logger.info("DB: schema init skipped (insufficient privileges — schema already exists)")
        else:
            logger.error("DB: schema init error: %s", e)
            raise DatabaseError(
                f"Schema initialisation failed ({backend}): {e}",
                details={"backend": backend},
            ) from e
    return engine


def execute(sql: str, params: dict | None = None):
    with get_engine().begin() as conn:
        conn.execute(text(sql), params or {})


def executemany(sql: str, params_list: list[dict], batch_size: int = 1000):
    engine = get_engine()
    for i in range(0, len(params_list), batch_size):
        batch = params_list[i : i + batch_size]
        with engine.begin() as conn:
            conn.execute(text(sql), batch)


def fetchall(sql: str, params: dict | None = None) -> list[dict]:
    with get_engine().connect() as conn:
        result = conn.execute(text(sql), params or {})
        cols = list(result.keys())
        return [dict(zip(cols, row)) for row in result.fetchall()]


def fetchone(sql: str, params: dict | None = None) -> dict | None:
    rows = fetchall(sql, params)
    return rows[0] if rows else None


def copy_from_csv(file_obj, table: str, columns: list[str]):
    if get_backend() == "sqlite":
        import pandas as pd
        df = pd.read_csv(file_obj)
        df.columns = [c.strip().lower() for c in df.columns]
        cols_present = [c for c in columns if c in df.columns]
        df[cols_present].to_sql(
            table, get_engine(), if_exists="append", index=False, chunksize=500
        )
    else:
        cols = ", ".join(columns)
        with get_engine().begin() as conn:
            cursor = conn.connection.cursor()
            cursor.copy_expert(
                f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true)",
                file_obj,
            )
