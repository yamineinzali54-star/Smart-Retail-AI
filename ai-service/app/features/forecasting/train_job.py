"""forecast_train job — run the file-based forecasting KDD pipeline.

Triggered by the "Train Model with latest dataset" button (via the web app)
or by the weekly Celery beat task. The job itself is deterministic apart
from the PRNG-free data path: the database is read once to refresh
dataset_raw.csv, then every step works on files.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.db import Database
from app.config import settings
from .dataset import collect_raw_csv, prepare_from_csv
from .trainer import train

DEFAULT_WINDOW_GRID = (3, 7, 14, 21, 28, 56)
DEFAULT_ALPHA_GRID = (0.0, 0.3, 0.7, 1.0)


class ForecastTrainJob(BaseJob):
    """params: {branch_code? str, run_name? str, activate? bool,
    collect? bool, window_grid? [int], alpha_grid? [float]}."""

    name = "forecast_train"

    def __init__(self, db: Database | None = None, on_step: Any = None) -> None:
        self._db = db
        # Optional progress callback: receives each pipeline step as it
        # completes so the caller can stream it (SSE).
        self._on_step = on_step

    def validate(self, ctx: JobContext) -> None:
        p = ctx.params
        branch_code = p.get("branch_code")
        if branch_code is not None and not isinstance(branch_code, str):
            raise ValueError("params.branch_code must be a string")
        activate = p.get("activate", True)
        if not isinstance(activate, bool):
            raise ValueError("params.activate must be a bool")
        for key in ("window_grid", "alpha_grid"):
            value = p.get(key)
            if value is not None and (
                not isinstance(value, (list, tuple)) or not value
            ):
                raise ValueError(f"params.{key} must be a non-empty list")

    def _artifact_dir(self) -> Path:
        return Path(settings.ai_artifact_dir)

    def _branch_code(self, ctx: JobContext) -> str:
        code = ctx.params.get("branch_code")
        if code:
            return str(code)
        if self._db is not None:
            rows = self._db.fetch_all(
                "SELECT code FROM branch WHERE id = %s", (ctx.branch_id,)
            )
            if rows:
                return str(rows[0]["code"])
        return ""

    def run(self, ctx: JobContext) -> JobResult:
        artifact_dir = self._artifact_dir()
        artifact_dir.mkdir(parents=True, exist_ok=True)
        branch_code = self._branch_code(ctx)
        raw_path = artifact_dir / "dataset_raw.csv"
        prepared_path = artifact_dir / "dataset_prepared.csv"

        pre_steps: list[dict[str, Any]] = []

        def _emit(step: dict[str, Any]) -> None:
            pre_steps.append(step)
            if self._on_step is not None:
                try:
                    self._on_step(step)
                except Exception:
                    pass

        collected: dict[str, Any] | None = None
        if ctx.params.get("collect", True) and self._db is not None:
            t0 = time.perf_counter()
            collected = collect_raw_csv(self._db, ctx.branch_id, raw_path)
            _emit({
                "step": "collect_dataset", "status": "ok",
                "duration_ms": round((time.perf_counter() - t0) * 1000),
                "detail": {
                    "rows": collected.get("rows"),
                    "bytes": collected.get("bytes"),
                    "sha256": collected.get("sha256", "")[:16],
                    "branch_code": branch_code,
                    "source": str(raw_path),
                },
            })

        t0 = time.perf_counter()
        prepared = prepare_from_csv(raw_path, prepared_path)
        cleaning = prepared.get("cleaning", {})
        _emit({
            "step": "prepare_dataset", "status": "ok",
            "duration_ms": round((time.perf_counter() - t0) * 1000),
            "detail": {
                "products": prepared.get("products"),
                "calendar_days": prepared.get("calendar_days"),
                "day_range": [prepared.get("day_from"), prepared.get("day_to")],
                "non_zero_cells": prepared.get("non_zero_cells"),
                "zero_filled_cells": prepared.get("zero_filled_cells"),
                "sparsity_pct": round(
                    prepared.get("zero_filled_cells", 0)
                    / max(prepared.get("rows", 1), 1) * 100, 1,
                ),
                "dropped_duplicate": cleaning.get("dropped_duplicate"),
                "dropped_status": cleaning.get("dropped_status"),
                "dropped_nonpositive": cleaning.get("dropped_nonpositive"),
                "dropped_incomplete": cleaning.get("dropped_incomplete"),
                "returned_lines": cleaning.get("returned_lines"),
                "returned_units": cleaning.get("returned_units"),
            },
        })

        run_name = ctx.params.get("run_name") or (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            + (f"_{branch_code}" if branch_code else "")
        )
        run_dir = artifact_dir / "runs" / run_name
        window_grid = tuple(ctx.params.get("window_grid") or DEFAULT_WINDOW_GRID)
        alpha_grid = tuple(ctx.params.get("alpha_grid") or DEFAULT_ALPHA_GRID)
        result = train(
            run_dir, prepared_path,
            window_grid=window_grid, alpha_grid=alpha_grid,
            dataset_meta=prepared,
            activate=bool(ctx.params.get("activate", True)),
            branch_id=ctx.branch_id, branch_code=branch_code,
            active_path=artifact_dir / "active.json",
            on_step=self._on_step,
        )
        all_steps = pre_steps + result["steps"]
        # train() wrote steps.json with only its own steps; rewrite it so
        # collect_dataset + prepare_dataset survive a page reload too.
        steps_path = run_dir / "steps.json"
        tmp = steps_path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps({"steps": all_steps}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, steps_path)
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
            "run_id": run_name,
            "run_dir": str(run_dir),
            "branch_code": branch_code,
            "collected": collected,
            "prepared": prepared,
            "model": result["model"],
            "metrics": result["metrics"],
            "steps": all_steps,
            "manifest": result["manifest"],
        })
