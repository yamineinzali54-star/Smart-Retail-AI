from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.rag.answer import Narrator, RAGAnswerJob
from app.features.rag.sql_cache import SQLCache, make_cache_key

ANSWER_SCHEMA = {
    "sale": {
        "columns": ["grand_total", "branch_id"], "types": {},
        "branch_columns": ["branch_id"], "foreign_keys": [],
    },
}

INTENT_READ = '{"intent":"read","reply":""}'


class FakeDb:
    def __init__(self, rows=None, error=None):
        self._rows = rows if rows is not None else []
        self._error = error
        self.seen_sql: list[str] = []

    def get_schema(self):
        return ANSWER_SCHEMA

    def fetch_all(self, sql, params=()):
        self.seen_sql.append(sql)
        if self._error:
            raise RuntimeError(self._error)
        return self._rows


SQL = "SELECT s.grand_total FROM sale AS s WHERE s.branch_id = 'YGN' LIMIT 5"
ROWS = [{"grand_total": "1500.00"}, {"grand_total": "2300.00"}]


def make_job(narration="Total sales are 3,800 Kyat.", rows=ROWS):
    llm = StubLLMProvider(script=[INTENT_READ, SQL, narration])
    return RAGAnswerJob(llm, FakeDb(rows))


def test_answer_happy_path():
    result = make_job().execute(JobContext(branch_id="YGN", params={"question": "today sales?"}))
    assert result.ok
    data = result.data
    assert data["sql"] == SQL
    assert data["row_count"] == 2 and not data["truncated"]
    assert data["answer"] == "Total sales are 3,800 Kyat."


def test_answer_truncates_wide_results():
    job = make_job(rows=[{"n": i} for i in range(60)])
    result = job.execute(JobContext(branch_id="YGN", params={"question": "all?"}))
    assert result.ok and result.data["truncated"] and result.data["row_count"] == 50


def test_answer_fails_closed_on_guarded_sql():
    llm = StubLLMProvider(script=[INTENT_READ, "DELETE FROM sale WHERE branch_id = 'YGN'"])
    db = FakeDb(ROWS)
    result = RAGAnswerJob(llm, db).execute(
        JobContext(branch_id="YGN", params={"question": "wipe?"}))
    assert result.ok and result.data.get("failure") is True
    assert db.seen_sql == []  # the rejected write never reached the database


def test_answer_fails_closed_without_db():
    llm = StubLLMProvider(SQL)
    result = RAGAnswerJob(llm, None).execute(
        JobContext(branch_id="YGN", params={"question": "sales?"}))
    assert not result.ok and result.error == "AI_DB_UNAVAILABLE"


def test_answer_fails_on_db_error():
    llm = StubLLMProvider(script=[INTENT_READ, SQL])
    result = RAGAnswerJob(llm, FakeDb(error="conn refused")).execute(
        JobContext(branch_id="YGN", params={"question": "sales?"}))
    assert result.ok and result.data.get("failure") is True
    assert "conn refused" in result.data["answer"]


def test_narration_failure_falls_back_to_rows():
    class Boom:
        def complete(self, *a, **k):
            raise RuntimeError("llm down")

    text = Narrator(Boom()).narrate(question="sales?", sql=SQL, rows=ROWS)  # type: ignore[arg-type]
    assert "2 row(s)" in text and "1500.00" in text


def test_narrator_without_llm_uses_fallback():
    text = Narrator(None).narrate(question="q", sql=SQL, rows=[])
    assert text == "No data found for your question."


def test_narrator_offline_stub_uses_fallback():
    # Missing API key → factory stub is offline=True; narration must fall
    # back to rule-based prose instead of surfacing the canned SQL.
    offline = StubLLMProvider("SELECT 'no key' AS notice", offline=True)
    text = Narrator(offline).narrate(question="q", sql=SQL, rows=ROWS)
    assert "SELECT" not in text and "2 row(s)" in text


def test_answer_invalidates_cached_sql_when_execution_fails():
    cache = SQLCache(redis_url=None)
    question = "today sales?"
    key = make_cache_key("YGN", ANSWER_SCHEMA, question)
    warm = RAGAnswerJob(
        StubLLMProvider(script=[INTENT_READ, SQL, "Total is 3,800."]),
        FakeDb(ROWS), cache=cache,
    )
    assert warm.execute(JobContext(branch_id="YGN", params={"question": question})).ok
    assert cache.get(key) is not None

    failing = RAGAnswerJob(
        StubLLMProvider(script=["diagnosis"]),
        FakeDb(error="conn refused"), cache=cache,
    )
    result = failing.execute(JobContext(branch_id="YGN", params={"question": question}))
    assert result.ok and result.data.get("failure") is True
    assert cache.get(key) is None  # stale entry dropped so the next run regenerates
