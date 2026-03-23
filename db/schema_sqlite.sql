-- BOQ Tracker Schema (SQLite-compatible)

-- Categories lookup table
CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    CHECK (name NOT LIKE '% %')
);

-- BOQ items
CREATE TABLE IF NOT EXISTS boq_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    code             TEXT NOT NULL UNIQUE,
    description      TEXT NOT NULL,
    unit             TEXT NOT NULL,
    budget_quantity  REAL NOT NULL DEFAULT 0
);

-- Progress entries (one row per submission)
CREATE TABLE IF NOT EXISTS progress_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    boq_item_id         INTEGER NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
    installed_quantity  REAL NOT NULL DEFAULT 0,
    entry_date          TEXT NOT NULL DEFAULT (date('now')),
    changed_at          TEXT DEFAULT (datetime('now'))
);

-- Staging table for fast CSV ingestion (raw text, no constraints)
CREATE TABLE IF NOT EXISTS boq_staging (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    category         TEXT,
    code             TEXT,
    description      TEXT,
    unit             TEXT,
    budget_quantity  TEXT,
    staged_at        TEXT DEFAULT (datetime('now'))
);

-- User roles
CREATE TABLE IF NOT EXISTS user_roles (
    username  TEXT PRIMARY KEY,
    role      TEXT NOT NULL CHECK (role IN ('progress_entry', 'budget', 'admin'))
);

-- Audit log: who did what
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    boq_item_id  INTEGER REFERENCES boq_items(id) ON DELETE SET NULL,
    item_code    TEXT,
    action       TEXT NOT NULL,
    changed_by   TEXT DEFAULT 'unknown',
    old_qty      REAL,
    new_qty      REAL,
    entry_date   TEXT,
    changed_at   TEXT DEFAULT (datetime('now'))
);
