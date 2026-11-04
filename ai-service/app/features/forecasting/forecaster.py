"""Demand forecasting (forecast job). Pure-Python moving-average baseline —
works from day one with thin history; swap in a statistical model later
without changing the job contract. LLM is NOT used here."""

from __future__ import annotations

from statistics import mean

from app.core.base_job import BaseJob, JobContext, JobResult
from .schemas import ReorderSuggestion

MIN_HISTORY_DAYS = 7


class DemandForecaster:
    def moving_average(self, daily_sales: list[float], window: int = 7) -> float:
        if not daily_sales:
            raise ValueError("daily_sales is empty")
        if window <= 0:
            raise ValueError("window must be positive")
        return float(mean(daily_sales[-window:]))

    def suggest_reorder(
        self,
        *,
        avg_daily_sales: float,
        lead_time_days: int,
        on_hand: float,
        safety_days: int = 3,
    ) -> float:
        if avg_daily_sales < 0 or on_hand < 0:
            raise ValueError("sales and stock must be non-negative")
        need = avg_daily_sales * (lead_time_days + safety_days) - on_hand
        return round(max(need, 0.0), 2)


class ForecastJob(BaseJob):
    """params.products: [{product_id, daily_sales:[...], on_hand, lead_time_days, safety_days?}]"""

    name = "forecast"

    def __init__(self) -> None:
        self._forecaster = DemandForecaster()

    def validate(self, ctx: JobContext) -> None:
        products = ctx.params.get("products")
        if not isinstance(products, list) or not products:
            raise ValueError("params.products must be a non-empty list")

    def run(self, ctx: JobContext) -> JobResult:
        suggestions: list[dict] = []
        for p in ctx.params["products"]:
            series = [float(x) for x in p.get("daily_sales", [])]
            if len(series) < MIN_HISTORY_DAYS:
                continue  # thin history: skip rather than guess
            avg = self._forecaster.moving_average(series)
            qty = self._forecaster.suggest_reorder(
                avg_daily_sales=avg,
                lead_time_days=int(p.get("lead_time_days", 7)),
                on_hand=float(p.get("on_hand", 0)),
                safety_days=int(p.get("safety_days", 3)),
            )
            s = ReorderSuggestion(
                product_id=str(p["product_id"]), avg_daily_sales=round(avg, 2),
                on_hand=float(p.get("on_hand", 0)), suggested_qty=qty,
            )
            suggestions.append(
                {"product_id": s.product_id, "avg_daily_sales": s.avg_daily_sales,
                 "on_hand": s.on_hand, "suggested_qty": s.suggested_qty,
                 "needs_order": s.needs_order}
            )
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True,
                         data={"suggestions": suggestions})
