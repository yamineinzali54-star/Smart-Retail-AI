import pytest

from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.pricing.optimizer import PriceOptimizeJob, PriceOptimizer
from app.services.job_registry import JobRegistry

THIN = [{"product_id": "p1", "cost": 95, "price": 100}]


def test_price_flags_thin_margin_only():
    flags = PriceOptimizer().margin_flags(
        [{"product_id": "p1", "cost": 95, "price": 100},
         {"product_id": "p2", "cost": 50, "price": 100}], min_margin_pct=10.0)
    assert [f["product_id"] for f in flags] == ["p1"]
    with pytest.raises(PermissionError):
        PriceOptimizer().apply()


def test_price_job():
    job = PriceOptimizeJob()
    result = job.execute(JobContext(branch_id="YGN", params={"items": THIN}))
    assert result.ok and len(result.data["thin_margin_flags"]) == 1
    assert result.data["insights"] == ""


def test_price_job_narration_gate():
    job = PriceOptimizeJob(StubLLMProvider("Thin margin on p1."))
    # default: deterministic path, no narration
    result = job.execute(JobContext(branch_id="YGN", params={"items": THIN}))
    assert result.ok and result.data["insights"] == ""
    # narrate=true → LLM narration
    result = job.execute(
        JobContext(branch_id="YGN", params={"items": THIN, "narrate": True}))
    assert result.ok and result.data["insights"] == "Thin margin on p1."


def test_price_job_offline_stub_narration_falls_back():
    canned = "SELECT 'no key' AS notice"
    job = PriceOptimizeJob(StubLLMProvider(canned, offline=True))
    result = job.execute(
        JobContext(branch_id="YGN", params={"items": THIN, "narrate": True}))
    assert result.ok
    insights = result.data["insights"]
    assert "margin floor" in insights and "SELECT" not in insights


def test_registry_price_optimize_uses_llm_override():
    override = StubLLMProvider("narrated.")
    job = JobRegistry(StubLLMProvider("env-stub")).create(
        "price_optimize", llm_override=override)
    assert job._narrator._llm is override


def test_registry_covers_all_planned_job_types():
    r = JobRegistry()
    assert r.job_types() == ["basket_build", "forecast", "forecast_build", "forecast_train",
                             "ops_alerts", "price_optimize", "promotion_suggest",
                             "rag_answer", "rag_query"]
    with pytest.raises(KeyError):
        r.create("nope")
