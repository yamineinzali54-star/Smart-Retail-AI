from datetime import datetime, timedelta, timezone

from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.alerts.analyzer import AbuseWatcher, DeadStockAnalyzer, SupplierPriceWatcher
from app.features.alerts.job import OpsAlertsJob


class FakeDb:
    def __init__(self, dead=None, price=None, abuse=None, error=None):
        self._data = {"last_sale": dead or [], "min_cost": price or [], "voids": abuse or []}
        self._error = error
        self.seen: list[tuple] = []

    def fetch_all(self, sql, params=()):
        self.seen.append((sql, params))
        if self._error:
            raise RuntimeError(self._error)
        for marker, rows in self._data.items():
            if marker in sql:
                return rows
        raise AssertionError(f"unexpected query: {sql[:60]}")


def iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


DEAD = [
    {"product_id": "p1", "product_name": "Stale", "on_hand": 50,
     "stock_value": 50000, "last_sale": iso(90)},
    {"product_id": "p2", "product_name": "Fresh", "on_hand": 10,
     "stock_value": 5000, "last_sale": iso(5)},
    {"product_id": "p3", "product_name": "Zero", "on_hand": 0,
     "stock_value": 0, "last_sale": iso(200)},
    {"product_id": "p4", "product_name": "Never", "on_hand": 7,
     "stock_value": 7000, "last_sale": None},
]
PRICE = [
    {"product_id": "p1", "product_name": "Up", "min_cost": 100, "max_cost": 115},
    {"product_id": "p2", "product_name": "Flat", "min_cost": 100, "max_cost": 102},
    {"product_id": "p3", "product_name": "Free", "min_cost": 0, "max_cost": 50},
]
ABUSE = [
    {"cashier": "a", "voids": 3, "total": 10, "discounts": 5000},
    {"cashier": "b", "voids": 0, "total": 40, "discounts": 30000},
    {"cashier": "c", "voids": 0, "total": 2, "discounts": 0},
]


def test_dead_stock_flags_stale_and_never_sold():
    out = DeadStockAnalyzer().analyze(DEAD, dead_days=60)
    assert [f["product_id"] for f in out] == ["p1", "p4"]  # value-sorted
    assert out[1]["days_since_sale"] is None


def test_price_watch_threshold_and_zero_guard():
    out = SupplierPriceWatcher().analyze(PRICE, min_change_pct=5)
    assert [f["product_id"] for f in out] == ["p1"]
    assert out[0]["change_pct"] == 15.0


def test_abuse_watch_rates_and_minimums():
    out = AbuseWatcher().analyze(ABUSE, min_sales=5, void_rate_pct=10, discount_warn=20000)
    by_cashier = {f["cashier"]: f["flags"] for f in out}
    assert by_cashier == {"a": ["high_void_rate"], "b": ["high_discounts"]}
    assert out[0]["void_rate_pct"] == 30.0


def test_job_end_to_end():
    job = OpsAlertsJob(StubLLMProvider("unused"), FakeDb(DEAD, PRICE, ABUSE))
    result = job.execute(JobContext(branch_id="YGN", params={}))
    assert result.ok
    assert result.data["counts"] == {"dead_stock": 2, "price_flags": 1, "abuse_flags": 2}
    assert len(result.data["dead_stock"]) == 2


def test_job_empty_is_ok():
    job = OpsAlertsJob(StubLLMProvider("unused"), FakeDb([], [], []))
    result = job.execute(JobContext(branch_id="YGN", params={}))
    assert result.ok and result.data["counts"] == {
        "dead_stock": 0, "price_flags": 0, "abuse_flags": 0}


def test_job_rejects_bad_params():
    job = OpsAlertsJob(StubLLMProvider("x"), FakeDb([], [], []))
    for params in ({"dead_days": 10}, {"price_days": 200}, {"sales_days": 5},
                   {"price_pct": 0}, {"void_rate_pct": 101}, {"min_sales": 0},
                   {"discount_warn": -1}):
        assert not job.execute(JobContext(branch_id="YGN", params=params)).ok


def test_job_fails_closed_on_db_error_or_missing_db():
    bad = OpsAlertsJob(StubLLMProvider("x"), FakeDb([], [], [], error="down"))
    assert not bad.execute(JobContext(branch_id="YGN", params={})).ok
    nodb = OpsAlertsJob(StubLLMProvider("x"), None)
    result = nodb.execute(JobContext(branch_id="YGN", params={}))
    assert not result.ok and result.error == "AI_DB_UNAVAILABLE"


def test_job_skips_narration_by_default():
    # Nightly scheduler / direct calls stay zero-LLM unless narrate=true.
    job = OpsAlertsJob(StubLLMProvider("unused"), FakeDb(DEAD, PRICE, ABUSE))
    result = job.execute(JobContext(branch_id="YGN", params={}))
    assert result.ok and result.data["insights"] == ""


def test_job_narrates_when_requested():
    job = OpsAlertsJob(StubLLMProvider("Eyes on Stale."), FakeDb(DEAD, PRICE, ABUSE))
    result = job.execute(JobContext(branch_id="YGN", params={"narrate": True}))
    assert result.ok and result.data["insights"] == "Eyes on Stale."


def test_job_offline_stub_narration_falls_back():
    # Missing API key → offline stub; narration must be rule-based prose.
    canned = "SELECT 'no key' AS notice"
    job = OpsAlertsJob(StubLLMProvider(canned, offline=True), FakeDb(DEAD, PRICE, ABUSE))
    result = job.execute(JobContext(branch_id="YGN", params={"narrate": True}))
    assert result.ok
    insights = result.data["insights"]
    assert "dead-stock" in insights and "SELECT" not in insights


def test_narrator_fallback_all_clear():
    from app.features.alerts.narrator import OpsAlertsNarrator

    text = OpsAlertsNarrator(None).narrate(
        counts={"dead_stock": 0, "price_flags": 0, "abuse_flags": 0},
        dead=[], price=[], abuse=[],
    )
    assert "No operational alerts" in text


def test_enqueue_ops_alerts_forwards_model_credentials(monkeypatch):
    import pytest
    from fastapi import HTTPException

    from app.api.routes import jobs as jobs_route
    from app.core.base_job import JobResult

    seen: dict = {}

    class FakeJob:
        def execute(self, ctx):
            return JobResult(job_id="j1", job_name="ops_alerts", ok=True, data={})

    class FakeRegistry:
        def create(self, job_type, *, llm_override=None):
            seen["job_type"] = job_type
            seen["llm"] = llm_override
            return FakeJob()

    monkeypatch.setattr(jobs_route, "get_registry", lambda: FakeRegistry())
    req = jobs_route.EnqueueRequest(job_type="ops_alerts", branch_id="YGN")

    # No headers → env/stub path (llm stays None)
    jobs_route.enqueue(req, ai_model_provider=None, ai_model=None, ai_api_key=None, ai_max_tokens=None)
    assert seen["llm"] is None

    # Headers present → generalized optional override builds a real provider
    jobs_route.enqueue(
        req, ai_model_provider="openrouter", ai_model="test-model",
        ai_api_key="sk-test", ai_max_tokens=None,
    )
    assert seen["llm"] is not None
    assert getattr(seen["llm"], "offline", False) is False

    # Half credentials fail closed
    with pytest.raises(HTTPException) as exc:
        jobs_route.enqueue(req, ai_model_provider=None, ai_model="m", ai_api_key=None, ai_max_tokens=None)
    assert exc.value.status_code == 400
