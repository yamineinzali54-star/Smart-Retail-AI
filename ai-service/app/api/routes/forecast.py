"""Forecast model management endpoints (token-protected by the app middleware).

  POST /forecast/train              retrain from the latest dataset
  GET  /forecast/artifacts          training runs + the active model
  GET  /forecast/artifacts/{run}/dataset   download the dataset CSV
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings
from app.core.base_job import JobContext
from app.features.forecasting.model_store import (
    active_model_info,
    artifact_root,
    list_runs,
)
from app.features.forecasting.train_job import ForecastTrainJob
from app.services.factory import get_db

router = APIRouter()


def _artifact_dir() -> Path:
    return Path(settings.ai_artifact_dir)


def _branch_id_for_code(branch_code: str) -> str:
    db = get_db()
    rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (branch_code,))
    if not rows:
        raise HTTPException(status_code=404, detail="branch not found")
    return str(rows[0]["id"])


@router.post("/forecast/train")
def train_forecast(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run the file-based KDD pipeline: refresh the dataset, fit, evaluate.

    The job writes the artifacts under AI_ARTIFACT_DIR and points
    active.json at the new model (the model the forecast job then serves).

    branch_id takes precedence over branch_code so the model is trained
    for the exact branch the admin is logged into.
    """
    params = payload or {}
    branch_id_param = str(params.get("branch_id") or "").strip()
    branch_code = str(params.get("branch_code") or "")
    if branch_id_param:
        db = get_db()
        rows = db.fetch_all("SELECT code FROM branch WHERE id = %s", (branch_id_param,))
        if not rows:
            raise HTTPException(status_code=404, detail="branch not found")
        branch_code = str(rows[0]["code"])
        branch_id = branch_id_param
    else:
        if not branch_code:
            branch_code = settings.nightly_branch_codes.split(",")[0].strip()
        try:
            branch_id = _branch_id_for_code(branch_code)
        except HTTPException:
            raise
    job = ForecastTrainJob(get_db())
    result = job.execute(JobContext(
        branch_id=branch_id,
        params={
            "branch_code": branch_code,
            "collect": bool(params.get("collect", True)),
            "activate": bool(params.get("activate", True)),
        },
    ))
    if not result.ok:
        return {"ok": False, "error": result.error or "training failed"}
    data = result.data
    return {
        "ok": True,
        "run_id": data.get("run_id"),
        "run_dir": data.get("run_dir"),
        "branch_code": data.get("branch_code"),
        "model": data.get("model"),
        "metrics": data.get("metrics"),
        "steps": data.get("steps"),
        "manifest": data.get("manifest"),
        "prepared": data.get("prepared"),
    }


@router.get("/forecast/artifacts")
def forecast_artifacts() -> dict[str, Any]:
    """Training runs (newest first) plus the active model.

    Only the 3 newest runs are returned (the dashboard shows the newest
    one; older runs are kept on disk for audit). test_samples are trimmed
    to the most recent 60 days per sample so the response stays small
    enough for the browser to parse reliably.
    """
    root = artifact_root()
    runs = list_runs(root)[:3]
    for run in runs:
        steps_path = Path(run["run_dir"]) / "steps.json"
        if steps_path.exists():
            try:
                run["steps"] = json.loads(steps_path.read_text(encoding="utf-8")).get("steps", [])
            except (OSError, ValueError):
                run["steps"] = []
        else:
            run["steps"] = []
        metrics_path = Path(run["run_dir"]) / "metrics.json"
        if metrics_path.exists():
            try:
                metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                metrics = {}
            run["per_product_mae"] = metrics.get("per_product_mae", [])
            # Trim test_samples: keep the most recent 60 days per sample so
            # the API response stays small enough for the browser to parse.
            # The chart only needs a readable window, not the full 154-day
            # test span.
            raw_samples = metrics.get("test_samples", [])
            trimmed_samples = []
            for sample in raw_samples:
                if not isinstance(sample, dict):
                    continue
                days = sample.get("days") or []
                actual = sample.get("actual") or []
                predicted = sample.get("predicted") or []
                n = len(days)
                if n > 60:
                    start = n - 60
                    trimmed_samples.append({
                        **sample,
                        "days": days[start:],
                        "actual": actual[start:],
                        "predicted": predicted[start:],
                    })
                else:
                    trimmed_samples.append(sample)
            run["test_samples"] = trimmed_samples
            run["split"] = metrics.get("split", {})
            run["test_cells"] = (metrics.get("test", {}) or {}).get("cells")
            run["validation_mae"] = metrics.get("validation_mae")
    return {
        "ok": True,
        "artifact_dir": str(root),
        "active": active_model_info(root),
        "runs": runs,
    }


@router.get("/forecast/artifacts/{run_id}/dataset")
def download_dataset(run_id: str, kind: str = "prepared") -> FileResponse:
    """Download a dataset CSV of a training run (prepared by default)."""
    root = artifact_root()
    if kind == "raw":
        path = root / "dataset_raw.csv"
        filename = "dataset_raw.csv"
    else:
        path = root / "runs" / run_id / "dataset_prepared.csv"
        filename = f"dataset_prepared_{run_id}.csv"
    if not path.exists():
        # The prepared dataset lives next to the runs; fall back to the shared copy.
        fallback = root / "dataset_prepared.csv"
        if kind != "raw" and fallback.exists():
            path = fallback
            filename = "dataset_prepared.csv"
        else:
            raise HTTPException(status_code=404, detail="dataset not found")
    return FileResponse(
        path, media_type="text/csv", filename=filename,
        headers={"content-disposition": f'attachment; filename="{filename}"'},
    )
