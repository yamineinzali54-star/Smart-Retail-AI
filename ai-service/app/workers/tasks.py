"""Nightly jobs (Celery Beat) wired to the DB-backed build jobs."""

from __future__ import annotations

from typing import Any

from app.core.base_job import JobContext
from app.features.forecasting.revenue import train_revenue_model
from app.services.factory import get_db, get_registry

try:
    from .celery_app import celery

    task = celery.task if celery is not None else (lambda *a, **k: (lambda f: f))
except Exception:  # no broker in dev — plain functions

    def task(*a, **k):  # type: ignore[no-untyped-def]
        def wrap(f):  # type: ignore[no-untyped-def]
            return f

        return wrap


def _resolve_branch_id(db: Any, branch_code: str) -> str:
    rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (branch_code,))
    if not rows or not rows[0].get("id"):
        raise ValueError(f"branch not found: {branch_code}")
    return str(rows[0]["id"])


def _run(job_type: str, branch_code: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        branch_id = _resolve_branch_id(get_db(), branch_code)
        job = get_registry().create(job_type)
        result = job.execute(JobContext(branch_id=branch_id, params=params))
    except Exception as exc:
        return {"ok": False, "job": job_type, "job_id": "",
                "data": {}, "error": str(exc)}
    return {"ok": result.ok, "job": result.job_name, "job_id": result.job_id,
            "data": result.data, "error": result.error}


@task(name="ai.nightly_forecast")
def nightly_forecast(branch_code: str = "YGN", days: int = 30) -> dict[str, Any]:
    return _run("forecast_build", branch_code, {"days": days})


@task(name="ai.nightly_basket")
def nightly_basket(branch_code: str = "YGN", days: int = 90) -> dict[str, Any]:
    return _run("basket_build", branch_code, {"days": days})


@task(name="ai.nightly_alerts")
def nightly_alerts(branch_code: str = "YGN") -> dict[str, Any]:
    return _run("ops_alerts", branch_code, {})


@task(name="ai.weekly_forecast_train")
def weekly_forecast_train(branch_code: str = "YGN") -> dict[str, Any]:
    """Retrain the demand forecaster (Sunday 00:00 Myanmar time).

    Runs the file-based KDD pipeline: refresh dataset_raw.csv from the
    database, prepare it, fit the model, evaluate it and point active.json
    at the new run. The model then serves the coming week.
    """
    try:
        branch_id = _resolve_branch_id(get_db(), branch_code)
        job = get_registry().create("forecast_train")
        result = job.execute(JobContext(
            branch_id=branch_id,
            params={"branch_code": branch_code, "collect": True, "activate": True},
        ))
    except Exception as exc:
        return {"ok": False, "job": "forecast_train", "job_id": "",
                "data": {}, "error": str(exc)}
    return {"ok": result.ok, "job": result.job_name, "job_id": result.job_id,
            "data": result.data, "error": result.error}


@task(name="ai.weekly_revenue_forecast_train")
def weekly_revenue_forecast_train(branch_code: str = "YGN") -> dict[str, Any]:
    """Retrain the weekly revenue model (Sunday 00:15 Myanmar time)."""
    try:
        db = get_db()
        branch_id = _resolve_branch_id(db, branch_code)
        result = train_revenue_model(db, branch_id)
    except Exception as exc:
        return {"ok": False, "job": "revenue_forecast_train", "data": {}, "error": str(exc)}
    return {"ok": True, "job": "revenue_forecast_train", "data": result, "error": None}
