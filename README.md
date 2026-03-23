# BOQ Tracker

A web application for tracking Bill of Quantities (BOQ) against installed progress on construction and engineering projects. Runs locally or hosted on a service in production.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLAlchemy |
| Frontend | React + Vite + Tailwind CSS |
| Database | Azure PostgreSQL (Azure AD auth) / SQLite (local fallback) |
| Auth | Microsoft Interactive Browser (via `azure-identity`) |

## Features

- **BOQ import** — bulk CSV import via PostgreSQL `COPY` into a staging table, then server-side upsert into the live table (handles millions of rows)
- **Progress tracking** — log installed quantities against BOQ items by date
- **Role management** — per-user roles (viewer / editor / admin)
- **Audit log** — full history of changes
- **Azure AD auth** — token-based login for Azure PostgreSQL, no passwords stored

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Azure PostgreSQL instance with AAD authentication enabled (or run in SQLite mode)

### Install

```bash
# Backend
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### Configure

Enter your Azure PostgreSQL connection details in the **Setup** page of the UI after starting the app.

### Run

```bash
start.cmd
```

### Data

Sample BOQ data is in `data/`:

| File | Rows | Description |
|---|---|---|
| `boq_oil_gas_1000.csv` | 1,000 | Small sample for quick testing |
| `boq_oil_gas_100k.csv` | 100,000 | Large sample for load testing |
| `progress_sample.csv` | — | Sample progress entries |

Use `data/generate_boq.py` to generate larger datasets.

## Project Structure

```
├── main.py               # FastAPI app entry point
├── routes/               # API route handlers
├── utils/queries.py      # All DB query logic
├── db/
│   ├── connection.py     # SQLAlchemy engine, COPY helper
│   ├── schema.sql        # PostgreSQL schema
│   └── schema_sqlite.sql # SQLite schema
├── config/settings.py    # Pydantic settings
├── frontend/             # React + Vite app
│   └── src/
│       ├── pages/        # Budget, Progress, Setup
│       └── api.ts        # API client
└── data/                 # Sample CSV data
```

## Notes

- `db/config.json` and `db/pg_token.json` are excluded from git — never commit these
- The app runs entirely locally; no cloud deployment is configured
