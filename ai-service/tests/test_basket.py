import pytest

from app.core.base_job import JobContext
from app.features.basket.analyzer import BasketJob, MarketBasketAnalyzer
from app.features.basket.promo_drafter import PromoDrafter


def test_cooccurrence_counts_pairs():
    a = MarketBasketAnalyzer()
    counts = a.cooccurrence([["A", "B"], ["A", "B"], ["A", "C"]])
    assert counts[("A", "B")] == 2
    assert counts[("A", "C")] == 1


def test_rules_respect_support_and_confidence():
    a = MarketBasketAnalyzer()
    rules = a.rules([["A", "B"], ["A", "B"], ["A", "C"]], min_support=2)
    assert any(r["antecedent"] == "B" and r["consequent"] == "A" and r["confidence"] == 1.0
               for r in rules)


def test_job_end_to_end():
    job = BasketJob()
    result = job.execute(JobContext(branch_id="YGN",
                                    params={"transactions": [["A", "B"], ["A", "B"]]}))
    assert result.ok and len(result.data["rules"]) > 0


def test_promo_draft_is_never_active():
    d = PromoDrafter().from_rule(antecedent="A", consequent="B")
    assert d["status"] == "draft" and d["is_ai_suggested"] is True
    with pytest.raises(PermissionError):
        PromoDrafter().activate()
