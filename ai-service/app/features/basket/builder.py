"""DB-backed market-basket build (basket_build job). One parameterized
read-only query pulls completed-sale product sets for the session branch;
MarketBasketAnalyzer mines association rules; PromoDrafter turns top rules
into DRAFT promotion payloads (never active — Admin activates in the web
app). Computed on demand so the page is always fresh."""

from __future__ import annotations

from typing import Any

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider
from .analyzer import MarketBasketAnalyzer
from .narrator import BasketNarrator
from .promo_drafter import PromoDrafter

MAX_RULES = 50
MAX_DRAFTS = 20
DEFAULT_DAYS = 90

TRANSACTIONS_QUERY = """
SELECT s.id AS sale_id, sd.product_id AS product_id, p.name AS product_name
FROM sale s
JOIN sale_detail sd ON sd.sale_id = s.id
JOIN products p ON p.id = sd.product_id
WHERE s.branch_id = %s AND s.status = 'completed'
  AND s.sale_date >= NOW() - (%s || ' days')::INTERVAL
"""


class BasketBuilder:
    def __init__(self, db: Database):
        self._db = db
        self._analyzer = MarketBasketAnalyzer()
        self._drafter = PromoDrafter()

    def transactions(self, *, branch_id: str, days: int) -> tuple[list[list[str]], dict[str, str]]:
        rows = self._db.fetch_all(TRANSACTIONS_QUERY, (branch_id, str(days)))
        names: dict[str, str] = {}
        by_sale: dict[str, set[str]] = {}
        for r in rows:
            pid = str(r["product_id"])
            names[pid] = str(r.get("product_name") or pid)
            by_sale.setdefault(str(r["sale_id"]), set()).add(pid)
        # Single-item baskets carry no pair signal.
        return [[pid for pid in sorted(items)] for items in by_sale.values() if len(items) >= 2], names

    def build(
        self,
        *,
        branch_id: str,
        days: int = DEFAULT_DAYS,
        min_support: int = 2,
        min_confidence: float = 0.3,
        discount_pct: float = 10.0,
    ) -> dict[str, Any]:
        transactions, names = self.transactions(branch_id=branch_id, days=days)
        rules = self._analyzer.rules(
            transactions, min_support=min_support, min_confidence=min_confidence
        )[:MAX_RULES]
        for r in rules:
            r["antecedent_name"] = names.get(r["antecedent"], r["antecedent"])
            r["consequent_name"] = names.get(r["consequent"], r["consequent"])
        drafts = [
            {
                **self._drafter.from_rule(
                    antecedent=r["antecedent"],
                    consequent=r["consequent"],
                    discount_pct=discount_pct,
                    name=f"Bundle: {names.get(r['antecedent'], r['antecedent'])} + "
                         f"{names.get(r['consequent'], r['consequent'])}",
                ),
                "support": r["support"],
                "confidence": r["confidence"],
            }
            for r in rules[:MAX_DRAFTS]
        ]
        return {
            "rules": rules,
            "drafts": drafts,
            "transaction_count": len(transactions),
            "days": days,
        }


class BasketBuildJob(BaseJob):
    """params: {days? 7-365, min_support? 2-100, min_confidence? 0.1-1.0,
    discount_pct? 1-90, narrate? bool}. Requires a Database. Deterministic
    compute; optional LLM narration only when params.narrate=true."""

    name = "basket_build"

    def __init__(self, llm: BaseLLMProvider, db: Database | None = None):
        self._builder: BasketBuilder | None = BasketBuilder(db) if db is not None else None
        self._narrator = BasketNarrator(llm)

    def validate(self, ctx: JobContext) -> None:
        if not ctx.branch_id:
            raise ValueError("branch_id is required")
        if self._builder is None:
            raise ValueError("AI_DB_UNAVAILABLE")
        p = ctx.params
        days = p.get("days", DEFAULT_DAYS)
        support = p.get("min_support", 2)
        conf = p.get("min_confidence", 0.3)
        pct = p.get("discount_pct", 10.0)
        if not isinstance(days, int) or not 7 <= days <= 365:
            raise ValueError("params.days must be an int in 7..365")
        if not isinstance(support, int) or not 2 <= support <= 100:
            raise ValueError("params.min_support must be an int in 2..100")
        if not isinstance(conf, (int, float)) or not 0.1 <= float(conf) <= 1.0:
            raise ValueError("params.min_confidence must be a number in 0.1..1.0")
        if not isinstance(pct, (int, float)) or not 1 <= float(pct) <= 90:
            raise ValueError("params.discount_pct must be a number in 1..90")

    def run(self, ctx: JobContext) -> JobResult:
        assert self._builder is not None
        p = ctx.params
        try:
            result = self._builder.build(
                branch_id=ctx.branch_id,
                days=int(p.get("days", DEFAULT_DAYS)),
                min_support=int(p.get("min_support", 2)),
                min_confidence=float(p.get("min_confidence", 0.3)),
                discount_pct=float(p.get("discount_pct", 10.0)),
            )
        except Exception as exc:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=False,
                             error=f"query failed: {exc}")
        if bool(p.get("narrate", False)):
            result["insights"] = self._narrator.narrate(
                rules=result["rules"], drafts=result["drafts"],
                transaction_count=result["transaction_count"],
                days=result["days"], locale=str(p.get("locale", "en")))
        else:
            result["insights"] = ""
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data=result)
