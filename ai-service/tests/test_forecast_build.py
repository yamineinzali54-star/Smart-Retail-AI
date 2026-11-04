from datetime import date, timedelta

from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.forecasting.builder import ForecastBuilder, ForecastBuildJob
from app.features.forecasting.narrator import ForecastNarrator


class FakeDb:
    def __init__(self, sales=None, stock=None, error=None):
        self._sales = sales if sales is not None else []
        self._stock = stock if stock is not None else []
        self._error = error
        self.seen: list[tuple] = []

    def fetch_all(self, sql, params=()):
        self.seen.append((sql, params))
        if self._error:
            raise RuntimeError(self._error)
        return self._stock if "FROM items" in sql else self._sales


def sale_row(pid, name, days_ago, qty):
    return {"product_id": pid, "product_name": name,
            "day": (date.today() - timedelta(days=days_ago)).isoformat(), "qty": qty}


def test_build_aligns_gappy_series_and_suggests():
    sales = [sale_row("p1", "Noodle", 0, 10), sale_row("p1", "Noodle", 1, 10),
             sale_row("p1", "Noodle", 6, 10)]
    stock = [{"product_id": "p1", "on_hand": 20, "reorder_threshold": 5}]
    forecasts = ForecastBuilder(FakeDb(sales, stock)).build(
        branch_id="YGN", days=7, window=7, lead_time_days=7, safety_days=3)
    (f,) = forecasts
    # series = [10,0,0,0,0,10,10] (oldest first) -> avg 30/7 ≈ 4.29
    assert f["avg_daily_sales"] == 4.29
    # 4.29 * 10 - 20 = 22.9 (rounded via suggest_reorder on unrounded avg)
    assert f["needs_order"] and f["suggested_qty"] > 0
    assert f["days_of_cover"] == round(20 / 4.29, 1)


def test_build_skips_zero_sale_products():
    sales = [sale_row("p1", "Noodle", 0, 0)]
    forecasts = ForecastBuilder(FakeDb(sales, [])).build(branch_id="YGN", days=7)
    assert forecasts == []


def test_build_marks_below_threshold():
    sales = [sale_row("p1", "Noodle", 0, 2)]
    stock = [{"product_id": "p1", "on_hand": 3, "reorder_threshold": 5}]
    (f,) = ForecastBuilder(FakeDb(sales, stock)).build(branch_id="YGN", days=7)
    assert f["below_threshold"] is True


def test_job_end_to_end_with_narration():
    sales = [sale_row("p1", "Noodle", i, 10) for i in range(7)]
    stock = [{"product_id": "p1", "on_hand": 10, "reorder_threshold": 5}]
    job = ForecastBuildJob(StubLLMProvider("Order Noodle first."), FakeDb(sales, stock))
    result = job.execute(JobContext(branch_id="YGN", params={"days": 7}))
    assert result.ok
    data = result.data
    assert data["product_count"] == 1 and data["need_order_count"] == 1
    assert data["insights"] == "Order Noodle first."
    assert data["total_suggested_units"] == data["forecasts"][0]["suggested_qty"]


def test_job_fallback_narration_without_llm():
    class Boom:
        def complete(self, *a, **k):
            raise RuntimeError("llm down")

    sales = [sale_row("p1", "Noodle", 0, 1)]
    job = ForecastBuildJob(Boom(), FakeDb(sales, []))  # type: ignore[arg-type]
    result = job.execute(JobContext(branch_id="YGN", params={"days": 7}))
    assert result.ok and "need reordering" in result.data["insights"]


def test_job_offline_stub_does_not_leak_canned_sql():
    # Missing OPENROUTER_API_KEY → factory marks the stub offline=True; the
    # narrator must use the rule-based prose fallback, not the canned SQL.
    canned = "SELECT 'AI service has no OPENROUTER_API_KEY configured' AS notice"
    sales = [sale_row("p1", "Noodle", i, 10) for i in range(7)]
    stock = [{"product_id": "p1", "on_hand": 10, "reorder_threshold": 5}]
    job = ForecastBuildJob(StubLLMProvider(canned, offline=True), FakeDb(sales, stock))
    result = job.execute(JobContext(branch_id="YGN", params={"days": 7}))
    assert result.ok
    insights = result.data["insights"]
    assert "need reordering" in insights
    assert "SELECT" not in insights


def test_narrator_offline_stub_uses_fallback():
    stub = StubLLMProvider("SELECT 1", offline=True)
    text = ForecastNarrator(stub).narrate(
        forecasts=[{"needs_order": True, "product_name": "Noodle"}], days=7
    )
    assert "Noodle" in text and "SELECT" not in text


def test_registry_forecast_build_uses_llm_override():
    from app.services.job_registry import JobRegistry

    override = StubLLMProvider("narrated.")
    job = JobRegistry(StubLLMProvider("env-stub")).create(
        "forecast_build", llm_override=override
    )
    assert job._narrator._llm is override


def test_enqueue_forecast_build_forwards_model_credentials(monkeypatch):
    import pytest
    from fastapi import HTTPException

    from app.api.routes import jobs as jobs_route
    from app.core.base_job import JobResult

    seen: dict = {}

    class FakeJob:
        def execute(self, ctx):
            seen["branch"] = ctx.branch_id
            return JobResult(job_id="j1", job_name="forecast_build", ok=True, data={})

    class FakeRegistry:
        def create(self, job_type, *, llm_override=None):
            seen["job_type"] = job_type
            seen["llm"] = llm_override
            return FakeJob()

    monkeypatch.setattr(jobs_route, "get_registry", lambda: FakeRegistry())
    req = jobs_route.EnqueueRequest(job_type="forecast_build", branch_id="YGN")

    # No headers → env/stub path (llm stays None; offline stub → rule-based narration)
    resp = jobs_route.enqueue(req, ai_model_provider=None, ai_model=None, ai_api_key=None, ai_max_tokens=None)
    assert resp["ok"] is True and seen["llm"] is None

    # Headers present → DB-stored key/model built into a real provider
    resp = jobs_route.enqueue(
        req, ai_model_provider="openrouter", ai_model="test-model",
        ai_api_key="sk-test", ai_max_tokens=None,
    )
    assert resp["ok"] is True and seen["llm"] is not None
    assert getattr(seen["llm"], "offline", False) is False

    # Half credentials fail closed
    with pytest.raises(HTTPException) as exc:
        jobs_route.enqueue(req, ai_model_provider=None, ai_model="m", ai_api_key=None, ai_max_tokens=None)
    assert exc.value.status_code == 400


def test_job_rejects_bad_params():
    job = ForecastBuildJob(StubLLMProvider("x"), FakeDb([], []))
    for params in ({"days": 3}, {"days": 400}, {"window": 0}, {"window": 31},
                   {"lead_time_days": -1}, {"safety_days": 31}, {"locale": "fr"}):
        assert not job.execute(JobContext(branch_id="YGN", params=params)).ok


def test_job_fails_closed_on_db_error_or_missing_db():
    sales = [sale_row("p1", "Noodle", 0, 1)]
    bad = ForecastBuildJob(StubLLMProvider("x"), FakeDb(sales, [], error="down"))
    assert not bad.execute(JobContext(branch_id="YGN", params={})).ok
    nodb = ForecastBuildJob(StubLLMProvider("x"), None)
    result = nodb.execute(JobContext(branch_id="YGN", params={}))
    assert not result.ok and result.error == "AI_DB_UNAVAILABLE"


def test_narrator_healthy_fallback():
    text = ForecastNarrator(None).narrate(forecasts=[], days=30)
    assert "healthy" in text
