-- BOQ Tracker Schema

-- Categories lookup table
CREATE TABLE IF NOT EXISTS categories (
    id    SERIAL PRIMARY KEY,
    name  VARCHAR(100) NOT NULL UNIQUE,
    CONSTRAINT no_spaces CHECK (name NOT LIKE '% %')
);

-- BOQ items
CREATE TABLE IF NOT EXISTS boq_items (
    id               SERIAL PRIMARY KEY,
    category_id      INT REFERENCES categories(id) ON DELETE SET NULL,
    code             VARCHAR(50)  NOT NULL UNIQUE,
    description      TEXT         NOT NULL,
    unit             VARCHAR(20)  NOT NULL,
    budget_quantity  NUMERIC(12, 3) NOT NULL DEFAULT 0
);

-- Progress entries (one row per submission)
CREATE TABLE IF NOT EXISTS progress_entries (
    id                  SERIAL PRIMARY KEY,
    boq_item_id         INT NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
    installed_quantity  NUMERIC(12, 3) NOT NULL DEFAULT 0,
    entry_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    changed_at          TIMESTAMP DEFAULT NOW()
);

-- Staging table for fast CSV ingestion (raw text, no constraints)
CREATE TABLE IF NOT EXISTS boq_staging (
    id               SERIAL PRIMARY KEY,
    category         TEXT,
    code             TEXT,
    description      TEXT,
    unit             TEXT,
    budget_quantity  TEXT,
    staged_at        TIMESTAMP DEFAULT NOW()
);

-- User roles
CREATE TABLE IF NOT EXISTS user_roles (
    username  VARCHAR(200) PRIMARY KEY,
    role      VARCHAR(20)  NOT NULL CHECK (role IN ('progress_entry', 'budget', 'admin'))
);

-- Audit log: who did what
CREATE TABLE IF NOT EXISTS audit_log (
    id           SERIAL PRIMARY KEY,
    boq_item_id  INT REFERENCES boq_items(id) ON DELETE SET NULL,
    item_code    VARCHAR(50),
    action       VARCHAR(20) NOT NULL,
    changed_by   VARCHAR(100) DEFAULT 'unknown',
    old_qty      NUMERIC(12, 3),
    new_qty      NUMERIC(12, 3),
    entry_date   DATE,
    changed_at   TIMESTAMP DEFAULT NOW()
);
