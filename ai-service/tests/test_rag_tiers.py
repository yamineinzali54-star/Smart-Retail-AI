"""Tier-order contract for TextToSQLJob: cache (0 LLM calls) → intent+tool
(1 call) → full generation (2 calls), with SQLGuard re-checking every tier."""

import json

from app.core.base_job import JobContext
from app.features.rag.sql_cache import SQLCache, make_cache_key
from app.features.rag.text_to_sql import TextToSQLJob
from tests.test_sql_tools import BRANCH, TOOLS_SCHEMA

INTENT_READ = '{"intent":"read","reply":""}'
GEN_SQL = f"SELECT s.grand_total FROM sale AS s WHERE s.branch_id = '{BRANCH}' LIMIT 5"
QUESTION = "how are sales doing?"


def intent_with_tool(name: str, args: dict | None = None) -> str:
    return json.dumps({"intent": "read", "reply": "", "tool": name, "args": args or {}})


def ctx(question: str = QUESTION) -> JobContext:
    return JobContext(branch_id=BRANCH, params={"question": question})


class FakeDb:
    def __init__(self, schema=None, rows=None):
        self._schema = schema if schema is not None else TOOLS_SCHEMA
        self._rows = rows if rows is not None else []

    def get_schema(self):
        return self._schema

    def fetch_all(self, sql, params=()):
        return self._rows


class CountingLLM:
    """Returns scripted responses and fails the run on any extra call."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def complete(self, prompt, *, system="", json_mode=False):
        self.calls += 1
        if not self._responses:
            raise AssertionError(f"unexpected LLM call #{self.calls}")
        return self._responses.pop(0)


def test_cache_hit_skips_every_llm_call():
    cache = SQLCache(redis_url=None)
    cache.set(make_cache_key(BRANCH, TOOLS_SCHEMA, QUESTION), {
        "sql": GEN_SQL, "understanding": "u", "plan": [], "suggestions": ["s"],
    })
    progress: list[str] = []
    llm = CountingLLM([])
    job = TextToSQLJob(llm, FakeDb(), on_progress=progress.append, cache=cache)
    result = job.execute(ctx())
    assert result.ok, result.error
    assert llm.calls == 0
    assert result.data["sql_source"] == "cache"
    assert result.data["understanding"] == "u"
    assert "cache_hit" in progress and "sql_validated" in progress
    assert "calling_model" not in progress


def test_generate_then_reuse_from_cache():
    cache = SQLCache(redis_url=None)
    first = CountingLLM([INTENT_READ, GEN_SQL])
    progress: list[str] = []
    result = TextToSQLJob(
        first, FakeDb(), on_progress=progress.append, cache=cache,
    ).execute(ctx())
    assert result.ok, result.error
    assert first.calls == 2
    assert result.data["sql_source"] == "model"
    assert "calling_model" in progress and "intent_readonly" in progress

    second = CountingLLM([])
    reused = TextToSQLJob(second, FakeDb(), cache=cache).execute(ctx())
    assert reused.ok and reused.data["sql_source"] == "cache"
    assert second.calls == 0


def test_tool_tier_uses_one_llm_call_and_caches():
    cache = SQLCache(redis_url=None)
    question = "best selling products last week"
    llm = CountingLLM([intent_with_tool("top_products", {"days": 7, "limit": 5})])
    progress: list[str] = []
    result = TextToSQLJob(
        llm, FakeDb(), on_progress=progress.append, cache=cache,
    ).execute(ctx(question))
    assert result.ok, result.error
    assert llm.calls == 1
    assert result.data["sql_source"] == "tool"
    assert "tool_matched" in progress
    assert "calling_model" not in progress
    assert "sale_detail" in result.data["sql"]
    assert BRANCH in result.data["sql"]
    assert result.data["plan"][0]["table"] == "sale_detail"

    reused = TextToSQLJob(CountingLLM([]), FakeDb(), cache=cache).execute(ctx(question))
    assert reused.ok and reused.data["sql_source"] == "cache"


def test_write_intent_refuses_without_generation():
    cache = SQLCache(redis_url=None)
    question = "delete all sales"
    llm = CountingLLM([json.dumps({"intent": "write", "reply": "no changes made"})])
    progress: list[str] = []
    result = TextToSQLJob(
        llm, FakeDb(), on_progress=progress.append, cache=cache,
    ).execute(ctx(question))
    assert result.ok and result.data["refused"] is True
    assert result.data["answer"] == "no changes made"
    assert llm.calls == 1
    assert "calling_model" not in progress
    assert cache.get(make_cache_key(BRANCH, TOOLS_SCHEMA, question)) is None


def test_unknown_tool_falls_back_to_generation():
    llm = CountingLLM([intent_with_tool("does_not_exist"), GEN_SQL])
    result = TextToSQLJob(llm, FakeDb(), cache=SQLCache(redis_url=None)).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert llm.calls == 2


def test_rejected_tool_args_fall_back_to_generation():
    llm = CountingLLM([intent_with_tool("po_status", {"status": "nonsense"}), GEN_SQL])
    result = TextToSQLJob(llm, FakeDb(), cache=SQLCache(redis_url=None)).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert llm.calls == 2


def test_guard_failure_on_tool_falls_back_to_generation():
    llm = CountingLLM([intent_with_tool("top_products"), GEN_SQL])
    progress: list[str] = []
    sale_only_schema = {"sale": TOOLS_SCHEMA["sale"]}
    result = TextToSQLJob(
        llm, FakeDb(schema=sale_only_schema),
        on_progress=progress.append, cache=SQLCache(redis_url=None),
    ).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert "calling_model" in progress
    assert llm.calls == 2


def test_stale_cached_sql_is_dropped_and_regenerated():
    cache = SQLCache(redis_url=None)
    cache.set(make_cache_key(BRANCH, TOOLS_SCHEMA, QUESTION), {
        "sql": "DELETE FROM sale", "understanding": "u", "plan": [], "suggestions": [],
    })
    llm = CountingLLM([INTENT_READ, GEN_SQL])
    result = TextToSQLJob(llm, FakeDb(), cache=cache).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert llm.calls == 2
    stored = cache.get(make_cache_key(BRANCH, TOOLS_SCHEMA, QUESTION))
    assert stored is not None and "DELETE" not in stored["sql"]


def test_schema_change_invalidates_cached_entries():
    cache = SQLCache(redis_url=None)
    cache.set(make_cache_key(BRANCH, TOOLS_SCHEMA, QUESTION), {
        "sql": GEN_SQL, "understanding": "u", "plan": [], "suggestions": [],
    })
    changed_schema = dict(TOOLS_SCHEMA, extra_table={
        "columns": ["id"], "types": {}, "branch_columns": [], "foreign_keys": [],
    })
    llm = CountingLLM([INTENT_READ, GEN_SQL])
    result = TextToSQLJob(llm, FakeDb(schema=changed_schema), cache=cache).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert llm.calls == 2


def test_job_without_cache_keeps_original_behaviour():
    llm = CountingLLM([INTENT_READ, GEN_SQL])
    result = TextToSQLJob(llm, FakeDb()).execute(ctx())
    assert result.ok and result.data["sql_source"] == "model"
    assert llm.calls == 2


def test_invalidate_cached_drops_entry_for_next_run():
    cache = SQLCache(redis_url=None)
    job = TextToSQLJob(CountingLLM([INTENT_READ, GEN_SQL]), FakeDb(), cache=cache)
    assert job.execute(ctx()).ok
    key = make_cache_key(BRANCH, TOOLS_SCHEMA, QUESTION)
    assert cache.get(key) is not None
    job.invalidate_cached()
    assert cache.get(key) is None
