"""DB-backed demand-forecast build (forecast_build job). Two parameterized
read-only queries pull daily sales per product plus on-hand stock for the
session branch; series are calendar-aligned (missing days = 0 sales);
DemandForecaster scores them; ForecastNarrator summarizes. Computed on
demand so the page is always fresh."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider
from .forecaster import DemandForecaster
from .model_store import active_model_info, load_active_model
from .narrator import ForecastNarrator
from .seasonal import predict_future, weekday_indices

MAX_FORECASTS = 200
DEFAULT_DAYS = 30
DEFAULT_WINDOW = 7

SALES_QUERY = """
SELECT sd.product_id AS product_id, p.name AS product_name,
       DATE(s.sale_date) AS day, SUM(sd.quantity) AS qty
FROM sale_detail sd
JOIN sale s ON s.id = sd.sale_id
JOIN products p ON p.id = sd.product_id AND p.is_deleted = false
WHERE s.branch_id = %s AND s.status = 'completed'
  AND s.sale_date >= NOW() - (%s || ' days')::INTERVAL
GROUP BY sd.product_id, p.name, DATE(s.sale_date)
"""

STOCK_QUERY = """
SELECT i.product_id AS product_id, p.name AS product_name,
       COALESCE(SUM(i.current_stock_quantity), 0) AS on_hand,
       MAX(p.reorder_threshold) AS reorder_threshold,
       CURRENT_DATE AS today
FROM items i
JOIN products p ON p.id = i.product_id
WHERE i.branch_id = %s AND p.is_deleted = false
GROUP BY i.product_id, p.name
"""


class ForecastBuilder:
    def __init__(self, db: Database):
        self._db = db
        self._forecaster = DemandForecaster()
        # Set by build(): "seasonal_model" or "moving_average".
        self.forecast_source = "moving_average"

    def build(
        self,
        *,
        branch_id: str,
        days: int = DEFAULT_DAYS,
        window: int = DEFAULT_WINDOW,
        lead_time_days: int = 7,
        safety_days: int = 3,
    ) -> list[dict[str, Any]]:
        sales_rows = self._db.fetch_all(SALES_QUERY, (branch_id, str(days)))
        stock_rows = self._db.fetch_all(STOCK_QUERY, (branch_id,))
        stock = {str(r["product_id"]): r for r in stock_rows}

        db_today = next((r.get("today") for r in stock_rows if r.get("today") is not None), None)
        today = db_today if isinstance(db_today, date) else (
            date.fromisoformat(str(db_today)[:10]) if db_today is not None else date.today()
        )
        calendar = [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
        by_product: dict[str, dict[str, Any]] = {}
        for r in stock_rows:
            pid = str(r["product_id"])
            by_product[pid] = {
                "product_id": pid,
                "product_name": str(r.get("product_name") or ""),
                "daily": {d: 0.0 for d in calendar},
            }
        for r in sales_rows:
            pid = str(r["product_id"])
            entry = by_product.setdefault(pid, {
                "product_id": pid,
                "product_name": str(r.get("product_name") or ""),
                "daily": {d: 0.0 for d in calendar},
            })
            day = str(r["day"])[:10]
            if day in entry["daily"]:
                entry["daily"][day] = float(r.get("qty") or 0)

        forecasts = []
        # A trained model (artifacts/forecast/active.json) is used when it
        # exists for this branch; otherwise we fall back to the moving
        # average so the page keeps working before the first training run.
        model = load_active_model(branch_id=branch_id)
        series_weekdays = weekday_indices(calendar)
        forecast_source = "moving_average"
        for pid, entry in by_product.items():
            series = [entry["daily"][d] for d in calendar]
            if sum(series) <= 0 and pid not in stock:
                continue
            avg = round(self._forecaster.moving_average(series, min(window, len(series))), 2)
            if model is not None:
                horizon = lead_time_days + safety_days
                future_days = [today + timedelta(days=offset + 1) for offset in range(horizon)]
                predictions = predict_future(
                    series, series_weekdays, horizon, model,
                    [day.weekday() for day in future_days],
                    product_id=pid,
                )
                if predictions:
                    avg = round(sum(predictions) / len(predictions), 2)
                    forecast_source = "seasonal_model"
            s = stock.get(pid, {})
            on_hand = float(s.get("on_hand") or 0)
            threshold = int(s["reorder_threshold"] if s.get("reorder_threshold") is not None else 5)
            suggested = self._forecaster.suggest_reorder(
                avg_daily_sales=avg, lead_time_days=lead_time_days,
                on_hand=on_hand, safety_days=safety_days,
            )
            forecasts.append({
                "product_id": pid,
                "product_name": entry["product_name"],
                "avg_daily_sales": avg,
                "on_hand": on_hand,
                "days_of_cover": round(on_hand / avg, 1) if avg > 0 else None,
                "reorder_threshold": threshold,
                "below_threshold": on_hand <= threshold,
                "suggested_qty": suggested,
                "needs_order": suggested > 0,
            })
        forecasts.sort(key=lambda f: (not f["needs_order"], -f["suggested_qty"]))
        # Which estimator produced avg_daily_sales: "seasonal_model" when a
        # trained model was available, otherwise "moving_average".
        self.forecast_source = forecast_source
        return forecasts


class ForecastBuildJob(BaseJob):
    """params: {days? 7-365, window? 1-30, lead_time_days? 0-60,
    safety_days? 0-30, locale? en|my}. Requires a Database."""

    name = "forecast_build"

    def __init__(self, llm: BaseLLMProvider, db: Database | None = None):
        self._builder: ForecastBuilder | None = ForecastBuilder(db) if db is not None else None
        self._narrator = ForecastNarrator(llm)

    def validate(self, ctx: JobContext) -> None:
        if not ctx.branch_id:
            raise ValueError("branch_id is required")
        if self._builder is None:
            raise ValueError("AI_DB_UNAVAILABLE")
        p = ctx.params
        days = p.get("days", DEFAULT_DAYS)
        window = p.get("window", DEFAULT_WINDOW)
        if not isinstance(days, int) or not 7 <= days <= 365:
            raise ValueError("params.days must be an int in 7..365")
        if not isinstance(window, int) or not 1 <= window <= 30:
            raise ValueError("params.window must be an int in 1..30")
        for key, lo, hi in (("lead_time_days", 0, 60), ("safety_days", 0, 30)):
            v = p.get(key, 7 if key == "lead_time_days" else 3)
            if not isinstance(v, int) or not lo <= v <= hi:
                raise ValueError(f"params.{key} must be an int in {lo}..{hi}")
        if p.get("locale", "en") not in ("en", "my"):
            raise ValueError("params.locale must be en or my")

    def run(self, ctx: JobContext) -> JobResult:
        assert self._builder is not None
        p = ctx.params
        try:
            forecasts = self._builder.build(
                branch_id=ctx.branch_id,
                days=int(p.get("days", DEFAULT_DAYS)),
                window=int(p.get("window", DEFAULT_WINDOW)),
                lead_time_days=int(p.get("lead_time_days", 7)),
                safety_days=int(p.get("safety_days", 3)),
            )
            forecast_source = self._builder.forecast_source
        except Exception as exc:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=False,
                             error=f"query failed: {exc}")
        truncated = len(forecasts) > MAX_FORECASTS
        visible = forecasts[:MAX_FORECASTS]
        needy = [f for f in forecasts if f["needs_order"]]
        insights = self._narrator.narrate(
            forecasts=forecasts, days=int(p.get("days", DEFAULT_DAYS)),
            locale=str(p.get("locale", "en")),
        )
        active = active_model_info()
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
            "forecasts": visible,
            "product_count": len(forecasts),
            "need_order_count": len(needy),
            "total_suggested_units": round(sum(f["suggested_qty"] for f in needy), 2),
            "truncated": truncated,
            "days": int(p.get("days", DEFAULT_DAYS)),
            "window": int(p.get("window", DEFAULT_WINDOW)),
            "insights": insights,
            "forecast_source": forecast_source,
            "model": {
                "trained_at": (active or {}).get("trained_at", ""),
                "algorithm": ((active or {}).get("model") or {}).get("algorithm", ""),
                "window": ((active or {}).get("model") or {}).get("window"),
                "test_mae": ((active or {}).get("metrics") or {}).get("test_mae"),
            } if forecast_source == "seasonal_model" else None,
        })
