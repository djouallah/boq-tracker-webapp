"""CSV import endpoints for BOQ items and progress entries."""
import io
import logging

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from routes._helpers import BUDGET_ROLES, require_role
from utils import queries

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["imports"])


@router.post("/import/boq/preview")
async def preview_boq(file: UploadFile = File(...), _user: str = require_role(BUDGET_ROLES)):
    content = await file.read()
    try:
        count = queries.stage_boq_csv(io.BytesIO(content))
        rows = queries.get_staged_rows()
        return {"count": count, "rows": rows}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/import/boq/confirm")
def confirm_boq_import(_user: str = require_role(BUDGET_ROLES)):
    try:
        count = queries.import_from_staging()
        return {"count": count}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/import/progress/preview")
async def preview_progress(file: UploadFile = File(...), _user: str = require_role(BUDGET_ROLES)):
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        required = {"code", "installed_quantity", "entry_date", "changed_by"}
        missing = required - set(df.columns)
        if missing:
            raise HTTPException(
                status_code=422, detail=f"Missing columns: {', '.join(sorted(missing))}"
            )
        rows = df[[*required]].fillna("").to_dict("records")
        return {"rows": rows}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/import/progress/confirm")
def confirm_progress_import(rows: list[dict], _user: str = require_role(BUDGET_ROLES)):
    try:
        count = queries.import_progress_entries(rows)
        return {"count": count}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
