"""Market-basket analysis (promotion_suggest job, part 1).
Co-occurrence counting + association rules — no LLM needed. The LLM only
drafts promo copy in promo_drafter.py."""

from __future__ import annotations

from collections import Counter
from itertools import combinations

from app.core.base_job import BaseJob, JobContext, JobResult


class MarketBasketAnalyzer:
    def cooccurrence(self, transactions: list[list[str]]) -> Counter[tuple[str, str]]:
        counts: Counter[tuple[str, str]] = Counter()
        for txn in transactions:
            for a, b in combinations(sorted(set(txn)), 2):
                counts[(a, b)] += 1
        return counts

    def rules(
        self,
        transactions: list[list[str]],
        *,
        min_support: int = 2,
        min_confidence: float = 0.3,
    ) -> list[dict]:
        if not 0 < min_confidence <= 1:
            raise ValueError("min_confidence must be in (0, 1]")
        item_support: Counter[str] = Counter()
        for txn in transactions:
            for item in set(txn):
                item_support[item] += 1
        out = []
        transaction_count = len(transactions)
        if transaction_count == 0:
            return out
        for (a, b), pair_support in self.cooccurrence(transactions).items():
            if pair_support < min_support:
                continue
            for antecedent, consequent in ((a, b), (b, a)):
                conf = pair_support / item_support[antecedent]
                consequent_support = item_support[consequent] / transaction_count
                lift = conf / consequent_support if consequent_support else 0.0
                if conf >= min_confidence:
                    out.append(
                        {"antecedent": antecedent, "consequent": consequent,
                         "support": pair_support, "support_rate": round(pair_support / transaction_count, 4),
                         "confidence": round(conf, 3), "lift": round(lift, 3)}
                    )
        return sorted(out, key=lambda r: (-r["lift"], -r["confidence"], -r["support"]))


class BasketJob(BaseJob):
    """params.transactions: [[product_id, ...], ...] (one list per sale)."""

    name = "promotion_suggest"

    def __init__(self) -> None:
        self._analyzer = MarketBasketAnalyzer()

    def validate(self, ctx: JobContext) -> None:
        txns = ctx.params.get("transactions")
        if not isinstance(txns, list) or not txns:
            raise ValueError("params.transactions must be a non-empty list")

    def run(self, ctx: JobContext) -> JobResult:
        rules = self._analyzer.rules(
            ctx.params["transactions"],
            min_support=int(ctx.params.get("min_support", 2)),
            min_confidence=float(ctx.params.get("min_confidence", 0.3)),
        )
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True,
                         data={"rules": rules})
