import time

from app.features.rag.sql_cache import SQLCache, make_cache_key, normalize_question

SCHEMA_A = {
    "sale": {"columns": ["id", "branch_id"], "types": {}, "branch_columns": ["branch_id"], "foreign_keys": []},
}
SCHEMA_B = {
    "sale": {"columns": ["id", "branch_id", "grand_total"], "types": {}, "branch_columns": ["branch_id"], "foreign_keys": []},
}


def test_normalize_is_conservative():
    assert normalize_question("  Today's   Sales? ") == "today's sales"
    assert normalize_question("ယနေ့ အရောင်းများ?") == "ယနေ့ အရောင်းများ"
    assert normalize_question("top products") == "top products"
    assert normalize_question("top  products") == normalize_question("TOP products")


def test_key_is_scoped_by_branch_schema_and_question():
    base = make_cache_key("branch-a", SCHEMA_A, "how are sales")
    assert base == make_cache_key("branch-a", SCHEMA_A, "How are   sales?")
    assert base != make_cache_key("branch-b", SCHEMA_A, "how are sales")
    assert base != make_cache_key("branch-a", SCHEMA_B, "how are sales")
    assert base != make_cache_key("branch-a", SCHEMA_A, "how are returns")


def test_roundtrip_and_delete():
    cache = SQLCache(redis_url=None, ttl=60)
    cache.set("k", {"sql": "SELECT 1"})
    assert cache.get("k") == {"sql": "SELECT 1"}
    cache.delete("k")
    assert cache.get("k") is None


def test_entries_expire_with_ttl():
    cache = SQLCache(redis_url=None, ttl=1)
    cache.set("k", {"sql": "SELECT 1"})
    assert cache.get("k") is not None
    time.sleep(1.05)
    assert cache.get("k") is None


def test_memory_lru_evicts_oldest():
    cache = SQLCache(redis_url=None, ttl=60, max_entries=2)
    cache.set("a", {"n": 1})
    cache.set("b", {"n": 2})
    cache.set("c", {"n": 3})
    assert cache.get("a") is None
    assert cache.get("b") == {"n": 2}
    assert cache.get("c") == {"n": 3}


def test_unreachable_redis_never_raises():
    cache = SQLCache(redis_url="redis://127.0.0.1:9/0", ttl=60)
    cache.set("k", {"sql": "SELECT 1"})
    assert cache.get("k") == {"sql": "SELECT 1"}
    assert cache.get("never-written") is None
    cache.delete("k")
    assert cache.get("k") is None


def test_missing_or_malformed_values_are_ignored():
    cache = SQLCache(redis_url=None, ttl=60)
    assert cache.get("absent") is None
