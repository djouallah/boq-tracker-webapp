from datetime import date as date_type
from db.connection import execute, executemany, fetchall, fetchone, copy_from_csv


# ── Categories ────────────────────────────────────────────────────────────────

def get_categories() -> list[dict]:
    return fetchall("SELECT id, name FROM categories ORDER BY name")


def _validate_category_name(name: str):
    if " " in name:
        raise ValueError(f"Category '{name}' must not contain spaces — use underscores or abbreviations (e.g. civil_works, CW).")


def add_category(name: str):
    _validate_category_name(name.strip())
    execute("INSERT INTO categories (name) VALUES (:name)", {"name": name.strip()})


def delete_category(category_id: int):
    execute("DELETE FROM categories WHERE id = :id", {"id": category_id})


# ── BOQ Items ─────────────────────────────────────────────────────────────────

def get_boq_items() -> list[dict]:
    return fetchall(
        """
        SELECT b.id, b.code, b.description, b.unit, b.budget_quantity,
               b.category_id, COALESCE(c.name, '') AS category
        FROM boq_items b
        LEFT JOIN categories c ON c.id = b.category_id
        ORDER BY c.name, b.code
        """
    )


def add_boq_item(category_id: int, code: str, description: str, unit: str, budget_quantity: float):
    execute(
        """
        INSERT INTO boq_items (category_id, code, description, unit, budget_quantity)
        VALUES (:category_id, :code, :description, :unit, :budget_quantity)
        """,
        {
            "category_id": category_id,
            "code": code.strip(),
            "description": description.strip(),
            "unit": unit.strip(),
            "budget_quantity": budget_quantity,
        },
    )


def update_boq_item(item_id: int, category_id: int, description: str, unit: str, budget_quantity: float):
    execute(
        """
        UPDATE boq_items
        SET category_id = :category_id, description = :description,
            unit = :unit, budget_quantity = :budget_quantity
        WHERE id = :id
        """,
        {
            "category_id": category_id,
            "description": description.strip(),
            "unit": unit.strip(),
            "budget_quantity": budget_quantity,
            "id": item_id,
        },
    )


def delete_boq_item(item_id: int):
    execute("DELETE FROM boq_items WHERE id = :id", {"id": item_id})


def get_next_code(prefix: str) -> str:
    """Return next available sequential code for a prefix, e.g. PIP-TRE.003.
    Looks globally across all categories since codes are unique table-wide.
    """
    row = fetchone(
        """
        SELECT COALESCE(MAX(CAST(SPLIT_PART(code, '.', 2) AS INTEGER)), 0) AS maxn
        FROM boq_items
        WHERE code LIKE :pattern
          AND SPLIT_PART(code, '.', 2) ~ '^[0-9]+$'
        """,
        {"pattern": f"{prefix.upper()}.%"},
    )
    return f"{prefix.upper()}.{(row['maxn'] + 1):03d}"


def stage_boq_csv(file_obj) -> int:
    """Clear staging table and stream CSV in via COPY (pg) or INSERT (sqlite)."""
    execute("DELETE FROM boq_staging")
    copy_from_csv(
        file_obj,
        table="boq_staging",
        columns=["category", "code", "description", "unit", "budget_quantity"],
    )
    return fetchone("SELECT COUNT(*) AS n FROM boq_staging")["n"]


def get_staged_rows() -> list[dict]:
    try:
        return fetchall(
            "SELECT category, code, description, unit, budget_quantity FROM boq_staging ORDER BY id"
        )
    except Exception:
        return []


def import_from_staging() -> int:
    """Upsert boq_staging into real tables entirely in SQL — no Python row loop."""
    n = fetchone("SELECT COUNT(*) AS n FROM boq_staging")["n"]
    if not n:
        raise ValueError("Staging table is empty — stage a CSV first.")

    # Step 1a: reject any category names with spaces
    bad = fetchall("""
        SELECT DISTINCT TRIM(category) AS name FROM boq_staging
        WHERE TRIM(COALESCE(category, '')) != ''
          AND TRIM(category) LIKE '% %'
    """)
    if bad:
        names = ", ".join(r["name"] for r in bad)
        raise ValueError(f"Category names must not contain spaces — fix these: {names}")

    # Step 1b: create any missing categories in one shot
    execute("""
        INSERT INTO categories (name)
        SELECT DISTINCT TRIM(category) FROM boq_staging
        WHERE TRIM(COALESCE(category, '')) != ''
        ON CONFLICT (name) DO NOTHING
    """)

    # Step 2: upsert items directly from staging — single round-trip
    execute("""
        INSERT INTO boq_items (category_id, code, description, unit, budget_quantity)
        SELECT
            c.id,
            TRIM(s.code),
            TRIM(s.description),
            TRIM(s.unit),
            CAST(s.budget_quantity AS NUMERIC)
        FROM boq_staging s
        JOIN categories c ON c.name = TRIM(s.category)
        WHERE TRIM(COALESCE(s.code, '')) != ''
        ON CONFLICT (code) DO UPDATE SET
            category_id     = EXCLUDED.category_id,
            description     = EXCLUDED.description,
            unit            = EXCLUDED.unit,
            budget_quantity = CAST(EXCLUDED.budget_quantity AS NUMERIC)
    """)

    return n


def import_boq_items(rows: list[dict]) -> int:
    """Bulk import items from CSV in a single atomic transaction.
    Each row must have: category, code, description, unit, budget_quantity.
    Raises ValueError on any validation error — nothing is inserted.
    If any DB insert fails, the entire import is rolled back.
    """
    # Step 1: validate every row before touching the DB
    validated = []
    for i, row in enumerate(rows, start=1):
        cat_name = str(row.get("category", "")).strip()
        code = str(row.get("code", "")).strip()
        description = str(row.get("description", "")).strip()
        unit = str(row.get("unit", "")).strip()
        if not cat_name:
            raise ValueError(f"Row {i}: 'category' is missing")
        if not code:
            raise ValueError(f"Row {i}: 'code' is missing")
        if not description:
            raise ValueError(f"Row {i}: 'description' is missing")
        if not unit:
            raise ValueError(f"Row {i}: 'unit' is missing")
        try:
            budget_quantity = float(row["budget_quantity"])
        except (ValueError, TypeError, KeyError):
            raise ValueError(f"Row {i} ({code}): 'budget_quantity' must be a number")
        validated.append((cat_name, code, description, unit, budget_quantity))

    # Step 2: resolve / create categories (each in its own small transaction)
    cat_map = {c["name"]: c["id"] for c in get_categories()}
    new_cats = {cat_name for cat_name, *_ in validated if cat_name not in cat_map}
    for cat_name in new_cats:
        add_category(cat_name)
    if new_cats:
        cat_map = {c["name"]: c["id"] for c in get_categories()}

    # Step 3: upsert all items — update category/description/unit/qty if code exists
    executemany(
        """
        INSERT INTO boq_items (category_id, code, description, unit, budget_quantity)
        VALUES (:category_id, :code, :description, :unit, :budget_quantity)
        ON CONFLICT (code) DO UPDATE SET
            category_id     = EXCLUDED.category_id,
            description     = EXCLUDED.description,
            unit            = EXCLUDED.unit,
            budget_quantity = EXCLUDED.budget_quantity
        """,
        [
            {
                "category_id": cat_map[cat_name],
                "code": code,
                "description": description,
                "unit": unit,
                "budget_quantity": budget_quantity,
            }
            for cat_name, code, description, unit, budget_quantity in validated
        ],
    )
    return len(validated)


# ── Dashboard ─────────────────────────────────────────────────────────────────

def get_dashboard_rows(
    limit: int = 100,
    offset: int = 0,
    category: str = "",
    search: str = "",
    progress_only: bool = False,
) -> list[dict]:
    conditions = []
    params: dict = {"limit": limit, "offset": offset}
    if category:
        conditions.append("c.name = :category")
        params["category"] = category
    if search:
        conditions.append("(LOWER(b.code) LIKE :search OR LOWER(b.description) LIKE :search)")
        params["search"] = f"%{search.lower()}%"
    if progress_only:
        conditions.append("EXISTS (SELECT 1 FROM progress_entries WHERE boq_item_id = b.id)")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return fetchall(
        f"""
        SELECT b.id, COALESCE(c.name, '') AS category, b.code, b.description,
               b.unit, b.budget_quantity,
               COALESCE((
                   SELECT installed_quantity FROM progress_entries
                   WHERE boq_item_id = b.id
                   ORDER BY entry_date DESC, id DESC LIMIT 1
               ), 0) AS installed_quantity,
               (
                   SELECT entry_date FROM progress_entries
                   WHERE boq_item_id = b.id
                   ORDER BY entry_date DESC, id DESC LIMIT 1
               ) AS entry_date
        FROM boq_items b
        LEFT JOIN categories c ON c.id = b.category_id
        {where}
        ORDER BY c.name, b.code
        LIMIT :limit OFFSET :offset
        """,
        params,
    )


def count_dashboard_rows(
    category: str = "",
    search: str = "",
    progress_only: bool = False,
) -> int:
    conditions = []
    params: dict = {}
    if category:
        conditions.append("c.name = :category")
        params["category"] = category
    if search:
        conditions.append("(LOWER(b.code) LIKE :search OR LOWER(b.description) LIKE :search)")
        params["search"] = f"%{search.lower()}%"
    if progress_only:
        conditions.append("EXISTS (SELECT 1 FROM progress_entries WHERE boq_item_id = b.id)")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    row = fetchone(
        f"""
        SELECT COUNT(*) AS n
        FROM boq_items b
        LEFT JOIN categories c ON c.id = b.category_id
        {where}
        """,
        params,
    )
    return row["n"] if row else 0


# ── Progress ──────────────────────────────────────────────────────────────────

def add_progress_entry(
    boq_item_id: int,
    installed_quantity: float,
    entry_date: date_type,
    changed_by: str = "unknown",
):
    # Fetch previous latest quantity for audit log
    prev = fetchone(
        """
        SELECT installed_quantity, b.code
        FROM progress_entries pe
        JOIN boq_items b ON b.id = pe.boq_item_id
        WHERE pe.boq_item_id = :item_id
        ORDER BY pe.entry_date DESC, pe.id DESC
        LIMIT 1
        """,
        {"item_id": boq_item_id},
    )
    old_qty = float(prev["installed_quantity"]) if prev else None
    item_code = prev["code"] if prev else fetchone(
        "SELECT code FROM boq_items WHERE id = :id", {"id": boq_item_id}
    )["code"]

    execute(
        """
        INSERT INTO progress_entries (boq_item_id, installed_quantity, entry_date)
        VALUES (:boq_item_id, :installed_quantity, :entry_date)
        """,
        {
            "boq_item_id": boq_item_id,
            "installed_quantity": installed_quantity,
            "entry_date": str(entry_date),
        },
    )

    execute(
        """
        INSERT INTO audit_log (boq_item_id, item_code, action, changed_by, old_qty, new_qty, entry_date)
        VALUES (:boq_item_id, :item_code, 'PROGRESS', :changed_by, :old_qty, :new_qty, :entry_date)
        """,
        {
            "boq_item_id": boq_item_id,
            "item_code": item_code,
            "changed_by": changed_by,
            "old_qty": old_qty,
            "new_qty": installed_quantity,
            "entry_date": str(entry_date),
        },
    )


# ── Progress Import ───────────────────────────────────────────────────────────

def import_progress_entries(rows: list[dict]) -> int:
    """Bulk import progress entries from CSV.
    Each row must have: code, installed_quantity, entry_date, changed_by.
    Raises ValueError on validation errors — nothing is inserted.
    """
    from datetime import datetime

    # Step 1: resolve all codes to boq_item ids
    all_items = {r["code"]: r["id"] for r in fetchall("SELECT id, code FROM boq_items")}

    validated = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("code", "")).strip()
        changed_by = str(row.get("changed_by", "")).strip()
        if not code:
            raise ValueError(f"Row {i}: 'code' is missing")
        if code not in all_items:
            raise ValueError(f"Row {i}: code '{code}' not found in BOQ items")
        if not changed_by:
            raise ValueError(f"Row {i} ({code}): 'changed_by' is missing")
        try:
            qty = float(row["installed_quantity"])
        except (ValueError, TypeError, KeyError):
            raise ValueError(f"Row {i} ({code}): 'installed_quantity' must be a number")
        try:
            entry_date = str(datetime.strptime(str(row.get("entry_date", "")).strip(), "%Y-%m-%d").date())
        except ValueError:
            raise ValueError(f"Row {i} ({code}): 'entry_date' must be YYYY-MM-DD")
        validated.append((all_items[code], code, qty, entry_date, changed_by))

    # Step 2: insert all in one atomic bulk operation (progress + audit)
    executemany(
        """
        INSERT INTO progress_entries (boq_item_id, installed_quantity, entry_date)
        VALUES (:boq_item_id, :installed_quantity, :entry_date)
        """,
        [{"boq_item_id": bid, "installed_quantity": qty, "entry_date": ed}
         for bid, _code, qty, ed, _by in validated],
    )
    executemany(
        """
        INSERT INTO audit_log (boq_item_id, item_code, action, changed_by, new_qty, entry_date)
        VALUES (:boq_item_id, :item_code, 'IMPORT', :changed_by, :new_qty, :entry_date)
        """,
        [{"boq_item_id": bid, "item_code": code, "changed_by": by, "new_qty": qty, "entry_date": ed}
         for bid, code, qty, ed, by in validated],
    )
    return len(validated)


# ── Progress History ──────────────────────────────────────────────────────────

def get_progress_history(boq_item_id: int) -> list[dict]:
    return fetchall(
        """
        SELECT pe.entry_date, pe.installed_quantity,
               COALESCE(al.changed_by, 'unknown') AS changed_by,
               pe.changed_at
        FROM progress_entries pe
        LEFT JOIN audit_log al
            ON al.boq_item_id = pe.boq_item_id
            AND al.new_qty = pe.installed_quantity
            AND al.entry_date = pe.entry_date
        WHERE pe.boq_item_id = :boq_item_id
        ORDER BY pe.entry_date DESC, pe.id DESC
        """,
        {"boq_item_id": boq_item_id},
    )


# ── Roles ─────────────────────────────────────────────────────────────────────

VALID_ROLES = {"progress_entry", "budget", "admin"}

# Role cache: username → (role | None, expiry_monotonic)
_role_cache: dict[str, tuple[str | None, float]] = {}
_ROLE_TTL = 60.0  # seconds


def _cache_get(username: str) -> tuple[bool, str | None]:
    import time
    entry = _role_cache.get(username)
    if entry and time.monotonic() < entry[1]:
        return True, entry[0]
    return False, None


def _cache_set(username: str, role: str | None):
    import time
    _role_cache[username] = (role, time.monotonic() + _ROLE_TTL)


def _cache_invalidate(username: str):
    _role_cache.pop(username, None)


def get_user_role(username: str) -> str | None:
    import db.connection as db_conn
    # SQLite = local dev mode: everyone is admin, no auth enforced
    if db_conn.get_backend() == "sqlite":
        return "admin"
    # PostgreSQL: check cache first to avoid repeated round-trips
    hit, cached_role = _cache_get(username)
    if hit:
        return cached_role
    # Single round-trip: always returns one row with role + table count
    row = fetchone(
        """
        SELECT
            (SELECT role FROM user_roles WHERE username = :username) AS role,
            (SELECT COUNT(*) FROM user_roles) AS total
        """,
        {"username": username},
    )
    role = row["role"] if row else None
    total = row["total"] if row else 1
    if role:
        _cache_set(username, role)
        return role
    if total == 0:
        set_user_role(username, "admin")
        _cache_set(username, "admin")
        return "admin"
    _cache_set(username, None)
    return None


def get_all_roles() -> list[dict]:
    return fetchall("SELECT username, role FROM user_roles ORDER BY username")


def set_user_role(username: str, role: str):
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role '{role}'. Must be one of: {', '.join(sorted(VALID_ROLES))}")
    execute(
        """
        INSERT INTO user_roles (username, role) VALUES (:username, :role)
        ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role
        """,
        {"username": username.strip(), "role": role},
    )
    _cache_invalidate(username.strip())


def delete_user_role(username: str):
    execute("DELETE FROM user_roles WHERE username = :username", {"username": username})
    _cache_invalidate(username)


# ── Audit ─────────────────────────────────────────────────────────────────────

def get_audit_log(limit: int = 100) -> list[dict]:
    return fetchall(
        """
        SELECT changed_at, changed_by, item_code, old_qty, new_qty, entry_date
        FROM audit_log
        ORDER BY changed_at DESC
        LIMIT :limit
        """,
        {"limit": limit},
    )
