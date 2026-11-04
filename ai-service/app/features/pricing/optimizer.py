"""Price optimization (price_optimize job). Suggest-only margin analysis:
flags thin-margin products for Admin review. No auto repricing — the shop
owner sets prices; this job only points at candidates. Deterministic compute;
optional LLM narration only when params.narrate=true."""

from __future__ import annotations

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.llm.base import BaseLLMProvider
from .narrator import PricingNarrator


class PriceOptimizer:
    def margin_pct(self, *, cost: float, price: float) -> float:
        if price <= 0:
            raise ValueError("price must be positive")
        return round((price - cost) / price * 100, 2)

    def margin_flags(self, items: list[dict], *, min_margin_pct: float = 10.0) -> list[dict]:
        flags = []
        for item in items:
            margin = self.margin_pct(cost=float(item["cost"]), price=float(item["price"]))
            if margin < min_margin_pct:
                flags.append({**item, "margin_pct": margin})
        return sorted(flags, key=lambda f: f["margin_pct"])

    def apply(self) -> None:
        raise PermissionError("AI must never change prices — Admin only")


class PriceOptimizeJob(BaseJob):
    """params.items: [{product_id, cost, price}]. params.narrate? bool."""

    name = "price_optimize"

    def __init__(self, llm: BaseLLMProvider | None = None) -> None:
        self._optimizer = PriceOptimizer()
        self._narrator = PricingNarrator(llm)

    def validate(self, ctx: JobContext) -> None:
        items = ctx.params.get("items")
        if not isinstance(items, list) or not items:
            raise ValueError("params.items must be a non-empty list")

    def run(self, ctx: JobContext) -> JobResult:
        flags = self._optimizer.margin_flags(
            ctx.params["items"],
            min_margin_pct=float(ctx.params.get("min_margin_pct", 10.0)),
        )
        if bool(ctx.params.get("narrate", False)):
            insights = self._narrator.narrate(
                flags=flags,
                min_margin_pct=float(ctx.params.get("min_margin_pct", 10.0)),
                locale=str(ctx.params.get("locale", "en")),
            )
        else:
            insights = ""
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True,
                         data={"thin_margin_flags": flags, "insights": insights})
