from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.basket.builder import BasketBuilder, BasketBuildJob


class FakeDb:
    def __init__(self, rows=None, error=None):
        self._rows = rows if rows is not None else []
        self._error = error
        self.seen: list[tuple] = []

    def fetch_all(self, sql, params=()):
        self.seen.append((sql, params))
        if self._error:
            raise RuntimeError(self._error)
        return self._rows


def sale_row(sale_id, pid, name):
    return {"sale_id": sale_id, "product_id": pid, "product_name": name}


ROWS = [
    sale_row("s1", "A", "Noodle"), sale_row("s1", "B", "Egg"),
    sale_row("s2", "A", "Noodle"), sale_row("s2", "B", "Egg"),
    sale_row("s3", "A", "Noodle"), sale_row("s3", "C", "Tea"),
    sale_row("s4", "D", "Solo"),  # single-item basket: no pair signal
]


def test_transactions_groups_and_drops_singles():
    txns, names = BasketBuilder(FakeDb(ROWS)).transactions(branch_id="YGN", days=90)
    assert sorted(map(sorted, txns)) == [["A", "B"], ["A", "B"], ["A", "C"]]
    assert names == {"A": "Noodle", "B": "Egg", "C": "Tea", "D": "Solo"}


def test_build_rules_and_draft_shape():
    result = BasketBuilder(FakeDb(ROWS)).build(branch_id="YGN", days=90)
    assert result["transaction_count"] == 3
    rules = result["rules"]
    assert any(r["antecedent"] == "B" and r["consequent"] == "A"
               and r["confidence"] == 1.0
               and r["antecedent_name"] == "Egg" and r["consequent_name"] == "Noodle"
               for r in rules)
    (draft, *_) = result["drafts"]
    assert draft["status"] == "draft" and draft["is_ai_suggested"] is True
    assert draft["type"] == "bundle" and len(draft["product_ids"]) == 2
    assert "Noodle" in draft["name"] and "support" in draft and "confidence" in draft


def test_build_empty_sales_returns_empty():
    result = BasketBuilder(FakeDb([])).build(branch_id="YGN", days=90)
    assert result == {"rules": [], "drafts": [], "transaction_count": 0, "days": 90}


def test_job_end_to_end():
    job = BasketBuildJob(StubLLMProvider("unused"), FakeDb(ROWS))
    result = job.execute(JobContext(branch_id="YGN", params={"days": 90}))
    assert result.ok and result.data["transaction_count"] == 3
    assert len(result.data["drafts"]) > 0


def test_job_rejects_bad_params():
    job = BasketBuildJob(StubLLMProvider("x"), FakeDb([]))
    for params in ({"days": 3}, {"days": 400}, {"min_support": 1},
                   {"min_confidence": 0.05}, {"discount_pct": 95}):
        assert not job.execute(JobContext(branch_id="YGN", params=params)).ok


def test_job_fails_closed_on_db_error_or_missing_db():
    bad = BasketBuildJob(StubLLMProvider("x"), FakeDb(ROWS, error="down"))
    assert not bad.execute(JobContext(branch_id="YGN", params={})).ok
    nodb = BasketBuildJob(StubLLMProvider("x"), None)
    result = nodb.execute(JobContext(branch_id="YGN", params={}))
    assert not result.ok and result.error == "AI_DB_UNAVAILABLE"


def test_job_skips_narration_by_default():
    # Nightly scheduler / direct calls stay zero-LLM unless narrate=true.
    job = BasketBuildJob(StubLLMProvider("unused"), FakeDb(ROWS))
    result = job.execute(JobContext(branch_id="YGN", params={"days": 90}))
    assert result.ok and result.data["insights"] == ""


def test_job_narrates_when_requested():
    job = BasketBuildJob(StubLLMProvider("Bundle Noodle with Egg."), FakeDb(ROWS))
    result = job.execute(JobContext(branch_id="YGN", params={"days": 90, "narrate": True}))
    assert result.ok and result.data["insights"] == "Bundle Noodle with Egg."


def test_job_offline_stub_narration_falls_back():
    canned = "SELECT 'no key' AS notice"
    job = BasketBuildJob(StubLLMProvider(canned, offline=True), FakeDb(ROWS))
    result = job.execute(JobContext(branch_id="YGN", params={"narrate": True}))
    assert result.ok
    insights = result.data["insights"]
    assert "co-purchase rule" in insights and "SELECT" not in insights


def test_narrator_fallback_no_rules():
    from app.features.basket.narrator import BasketNarrator

    text = BasketNarrator(None).narrate(
        rules=[], drafts=[], transaction_count=1, days=90)
    assert "Not enough co-purchase activity" in text
