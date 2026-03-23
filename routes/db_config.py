"""Database configuration and status endpoints."""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text as sa_text

import db.connection as db
from routes._helpers import ADMIN_ROLES, require_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["database"])


class DbConfigIn(BaseModel):
    backend: str
    sqlite_path: str = "data/boq_tracker.db"
    pg_host: str = ""
    pg_database: str = "postgres"
    pg_user: str = ""
    tenant_id: str = ""
    tenant_domain: str = ""
    client_id: str = ""
    client_secret: str = ""


class DbStatusOut(BaseModel):
    backend: str
    sqlite_path: str
    pg_host: Optional[str]
    pg_user: Optional[str]
    tenant_id: Optional[str]
    tenant_domain: Optional[str]
    client_id: Optional[str]
    connected: bool
    error: Optional[str]
    is_local: bool
    has_admin: bool


@router.get("/db-status", response_model=DbStatusOut)
def get_db_status():
    cfg = db.load_db_config()
    backend = cfg.get("backend", "sqlite")
    sqlite_path = cfg.get("sqlite_path", "data/boq_tracker.db")
    pg_host = cfg.get("pg_host")
    pg_user = cfg.get("pg_user")
    tenant_id = cfg.get("tenant_id")
    tenant_domain = cfg.get("pg_tenant_domain")
    client_id = cfg.get("client_id")

    connected = False
    error = None
    has_admin = False
    try:
        engine = db.get_engine()
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
            row = conn.execute(sa_text("SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1")).fetchone()
            has_admin = row is not None
        connected = True
    except Exception as e:
        error = str(e)

    return {
        "backend": backend,
        "sqlite_path": sqlite_path,
        "pg_host": pg_host,
        "pg_user": pg_user,
        "tenant_id": tenant_id,
        "client_id": client_id,
        "connected": connected,
        "error": error,
        "is_local": db.is_local(),
        "has_admin": has_admin,
        "tenant_domain": tenant_domain,
    }


class TenantDomainIn(BaseModel):
    tenant_domain: str


def _resolve_tenant(domain: str) -> tuple[str, str]:
    """Resolve tenant_id and onmicrosoft.com initial domain from a tenant domain.
    Returns (tenant_id, onmicrosoft_domain). Both may be empty strings on failure."""
    import urllib.request, json as _json
    try:
        url = f"https://login.microsoftonline.com/{domain}/.well-known/openid-configuration"
        with urllib.request.urlopen(url, timeout=5) as r:
            tenant_id = _json.loads(r.read())["issuer"].split("/")[3]
    except Exception:
        return "", ""
    # Derive the onmicrosoft.com initial domain by trying {name}.onmicrosoft.com
    name = domain.split(".")[0]
    onmicrosoft = f"{name}.onmicrosoft.com"
    try:
        url2 = f"https://login.microsoftonline.com/{onmicrosoft}/.well-known/openid-configuration"
        with urllib.request.urlopen(url2, timeout=5) as r:
            check_id = _json.loads(r.read())["issuer"].split("/")[3]
        if check_id != tenant_id:
            onmicrosoft = ""
    except Exception:
        onmicrosoft = ""
    return tenant_id, onmicrosoft


@router.post("/tenant-domain")
def save_tenant_domain(body: TenantDomainIn):
    cfg = db.load_db_config()
    domain = body.tenant_domain.strip()
    cfg["pg_tenant_domain"] = domain
    if domain:
        tenant_id, onmicrosoft = _resolve_tenant(domain)
        cfg["tenant_id"] = tenant_id
        cfg["pg_tenant_initial_domain"] = onmicrosoft
    else:
        cfg["tenant_id"] = ""
        cfg["pg_tenant_initial_domain"] = ""
    db.save_db_config(cfg)
    return {"ok": True}


class FirstAdminIn(BaseModel):
    username: str


@router.post("/first-admin")
def claim_first_admin(body: FirstAdminIn):
    try:
        engine = db.get_engine()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database not connected: {e}")

    with engine.connect() as conn:
        row = conn.execute(sa_text("SELECT 1 FROM user_roles WHERE role = 'admin' LIMIT 1")).fetchone()
    if row:
        raise HTTPException(status_code=403, detail="Admin already exists")

    with engine.begin() as conn:
        conn.execute(
            sa_text("INSERT INTO user_roles (username, role) VALUES (:u, 'admin')"),
            {"u": body.username},
        )
    return {"ok": True}


class ProvisionUserIn(BaseModel):
    email: str


@router.post("/provision-pg-user")
def provision_pg_user(body: ProvisionUserIn):
    """Use the caller's own Azure AD token to create a new principal in PostgreSQL.
    The caller must be set as the Entra Admin on the PostgreSQL server in Azure Portal."""
    try:
        host, database, pg_user = db._get_pg_config()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PostgreSQL not configured: {e}")

    creator = db._make_pg_creator(host, database, pg_user)
    try:
        conn = creator()
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Azure AD connection failed: {e}")

    try:
        conn.autocommit = True
        cur = conn.cursor()
        email = body.email.strip()

        # For guest users from other domains, pgaadauth needs the EXT UPN
        cfg = db.load_db_config()
        tenant_domain = cfg.get("pg_tenant_domain", "").strip()
        onmicrosoft = cfg.get("pg_tenant_initial_domain", "").strip()
        # Resolve onmicrosoft domain on the fly if not yet stored
        if tenant_domain and not onmicrosoft:
            _, onmicrosoft = _resolve_tenant(tenant_domain)
            if onmicrosoft:
                cfg["pg_tenant_initial_domain"] = onmicrosoft
                db.save_db_config(cfg)
        pg_principal = email
        if onmicrosoft and "@" in email:
            email_domain = email.split("@", 1)[1].lower()
            if email_domain != tenant_domain.lower():
                local, domain = email.split("@", 1)
                pg_principal = f"{local}_{domain}#EXT#@{onmicrosoft}"

        try:
            cur.execute("SELECT pgaadauth_create_principal(%s, false, false)", (pg_principal,))
        except Exception as e:
            if "already exists" not in str(e).lower():
                raise HTTPException(status_code=500, detail=f"pgaadauth_create_principal failed: {e}")

        cur.execute(f'GRANT CONNECT ON DATABASE "{database}" TO "{pg_principal}"')
        cur.execute(f'GRANT USAGE ON SCHEMA public TO "{pg_principal}"')
        cur.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{pg_principal}"')
        cur.execute(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{pg_principal}"')

        cur.close()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Provisioning failed: {e}")
    finally:
        conn.close()


@router.post("/db-config")
def save_db_config_endpoint(body: DbConfigIn, request: Request):
    # Skip role check when switching to SQLite or when DB is unreachable (bootstrap/recovery).
    if not db.is_local() and body.backend != 'sqlite':
        try:
            db.get_engine()
            db_reachable = True
        except Exception:
            db_reachable = False
        if db_reachable:
            from routes._helpers import detect_user
            from utils import queries
            user = detect_user(request)
            role = queries.get_user_role(user)
            if role not in ADMIN_ROLES:
                raise HTTPException(status_code=403, detail="Access denied. Required role: admin")
    new_cfg = {"backend": body.backend}
    if body.backend == "sqlite":
        new_cfg["sqlite_path"] = body.sqlite_path or "data/boq_tracker.db"
    else:
        new_cfg["pg_host"] = body.pg_host.strip()
        new_cfg["pg_database"] = body.pg_database.strip() or "postgres"
        new_cfg["pg_user"] = body.pg_user.strip()
        new_cfg["pg_tenant_domain"] = body.tenant_domain.strip()
        # Auto-resolve tenant_id from domain if provided
        tenant_id = body.tenant_id.strip()
        tenant_domain = body.tenant_domain.strip()
        if not tenant_id and tenant_domain:
            try:
                import urllib.request, json as _json
                url = f"https://login.microsoftonline.com/{tenant_domain}/.well-known/openid-configuration"
                with urllib.request.urlopen(url, timeout=5) as r:
                    issuer = _json.loads(r.read())["issuer"]
                    tenant_id = issuer.split("/")[3]
            except Exception:
                pass
        new_cfg["tenant_id"] = tenant_id
        new_cfg["client_id"] = body.client_id.strip()
        if body.client_secret.strip():
            new_cfg["client_secret"] = body.client_secret.strip()
    db.save_db_config(new_cfg)
    db.get_engine.cache_clear()
    try:
        db.get_engine()
        return {"ok": True, "connected": True}
    except Exception as e:
        return {"ok": True, "connected": False, "error": str(e)}
