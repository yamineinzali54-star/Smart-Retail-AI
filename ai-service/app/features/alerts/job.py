"""ops_alerts job: runs all three rule-based watchers in one pass.
Deterministic compute; optional LLM narration only when params.narrate=true
(so the nightly scheduler stays zero-LLM). Requires a Database."""

from __future__ import annotations

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider
from .analyzer import (
    ABUSE_QUERY,
    DEAD_STOCK_QUERY,
    PRICE_WATCH_QUERY,
    AbuseWatcher,
    DeadStockAnalyzer,
    SupplierPriceWatcher,
)
from .narrator import OpsAlertsNarrator

MAX_FLAGS = 100


class OpsAlertsJob(BaseJob):
    """params: {dead_days? 30-180, price_days? 7-180, price_pct? 1-100,
    sales_days? 7-90, void_rate_pct? 1-100, min_sales? 1-100,
    discount_warn? 0+, narrate? bool}."""

    name = "ops_alerts"

    def __init__(self, llm: BaseLLMProvider, db: Database | None = None):
        self._db = db
        self._narrator = OpsAlertsNarrator(llm)

    def validate(self, ctx: JobContext) -> None:
        if not ctx.branch_id:
            raise ValueError("branch_id is required")
        if self._db is None:
            raise ValueError("AI_DB_UNAVAILABLE")
        p = ctx.params
        ranges = {
            "dead_days": (30, 180), "price_days": (7, 180), "sales_days": (7, 90),
            "min_sales": (1, 100),
        }
        for key, (lo, hi) in ranges.items():
            v = p.get(key, {"dead_days": 60, "price_days": 90,
                            "sales_days": 30, "min_sales": 5}[key])
            if not isinstance(v, int) or not lo <= v <= hi:
                raise ValueError(f"params.{key} must be an int in {lo}..{hi}")
        for key, lo, hi in (("price_pct", 1, 100), ("void_rate_pct", 1, 100)):
            v = p.get(key, 5 if key == "price_pct" else 10)
            if not isinstance(v, (int, float)) or not lo <= float(v) <= hi:
                raise ValueError(f"params.{key} must be a number in {lo}..{hi}")
        dw = p.get("discount_warn", 20000)
        if not isinstance(dw, (int, float)) or float(dw) < 0:
            raise ValueError("params.discount_warn must be a non-negative number")

    def run(self, ctx: JobContext) -> JobResult:
        assert self._db is not None
        p = ctx.params
        try:
            dead_rows = self._db.fetch_all(
                DEAD_STOCK_QUERY,
                (ctx.branch_id, ctx.branch_id, ctx.branch_id))
            price_rows = self._db.fetch_all(
                PRICE_WATCH_QUERY,
                (ctx.branch_id, str(int(p.get("price_days", 90)))))
            abuse_rows = self._db.fetch_all(
                ABUSE_QUERY,
                (ctx.branch_id, str(int(p.get("sales_days", 30)))))
        except Exception as exc:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=False,
                             error=f"query failed: {exc}")
        dead = DeadStockAnalyzer().analyze(dead_rows, dead_days=int(p.get("dead_days", 60)))
        price = SupplierPriceWatcher().analyze(
            price_rows, min_change_pct=float(p.get("price_pct", 5)))
        abuse = AbuseWatcher().analyze(
            abuse_rows, min_sales=int(p.get("min_sales", 5)),
            void_rate_pct=float(p.get("void_rate_pct", 10)),
            discount_warn=float(p.get("discount_warn", 20000)))
        counts = {"dead_stock": len(dead), "price_flags": len(price),
                  "abuse_flags": len(abuse)}
        if bool(p.get("narrate", False)):
            insights = self._narrator.narrate(
                counts=counts, dead=dead, price=price, abuse=abuse,
                locale=str(p.get("locale", "en")))
        else:
            insights = ""
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
            "dead_stock": dead[:MAX_FLAGS],
            "price_flags": price[:MAX_FLAGS],
            "abuse_flags": abuse[:MAX_FLAGS],
            "counts": counts,
            "insights": insights,
        })
