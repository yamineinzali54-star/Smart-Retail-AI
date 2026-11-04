"""Question→SQL cache — the middle tier of the RAG pipeline.

Redis stores entries shared by the API process and the Celery workers; an
in-process LRU keeps the pipeline working when Redis is unreachable (every
operation is exception-safe and degrades to memory). Keys embed the
authenticated branch, a hash of the live schema, the Asia/Yangon civil date
(relative SQL embeds date literals, so entries must expire at midnight) and
a conservative question normalization. Only SQLGuard-validated payloads are
ever written; hits are re-validated by the job before execution.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

DEFAULT_TTL_SECONDS = 24 * 60 * 60
MAX_MEMORY_ENTRIES = 512
_REDIS_RETRY_SECONDS = 60.0
_BUSINESS_TZ = ZoneInfo("Asia/Yangon")
_WHITESPACE_RE = re.compile(r"\s+")
_EDGE_PUNCT = " .?!,;:'\"()[]{}"


def normalize_question(question: str) -> str:
    """Lowercase, collapse whitespace, trim edge punctuation — deliberately
    conservative so two different questions can never collide."""
    text = _WHITESPACE_RE.sub(" ", str(question).strip().lower())
    return text.strip(_EDGE_PUNCT)


def _civil_date() -> str:
    return datetime.now(_BUSINESS_TZ).date().isoformat()


def make_cache_key(branch_id: str, schema: dict[str, Any], question: str) -> str:
    schema_blob = json.dumps(schema, sort_keys=True, default=str)
    question_hash = hashlib.sha256(
        normalize_question(question).encode("utf-8")
    ).hexdigest()
    schema_hash = hashlib.sha256(schema_blob.encode("utf-8")).hexdigest()
    return f"srai:rag:sql:{branch_id}:{schema_hash}:{_civil_date()}:{question_hash}"


class SQLCache:
    """Memory-first LRU with a best-effort Redis layer for cross-process hits."""

    def __init__(
        self,
        redis_url: str | None = None,
        ttl: int = DEFAULT_TTL_SECONDS,
        max_entries: int = MAX_MEMORY_ENTRIES,
    ):
        self._redis_url = redis_url
        self._ttl = max(1, int(ttl))
        self._max_entries = max(1, int(max_entries))
        self._memory: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
        self._lock = threading.Lock()
        self._client: Any = None
        self._redis_down_until = 0.0

    def _redis_or_none(self) -> Any:
        if not self._redis_url:
            return None
        if time.monotonic() < self._redis_down_until:
            return None
        try:
            if self._client is None:
                import redis

                self._client = redis.Redis.from_url(
                    self._redis_url,
                    decode_responses=True,
                    socket_timeout=0.5,
                    socket_connect_timeout=0.5,
                )
            return self._client
        except Exception:
            self._redis_down_until = time.monotonic() + _REDIS_RETRY_SECONDS
            return None

    def _remember_failure(self) -> None:
        self._redis_down_until = time.monotonic() + _REDIS_RETRY_SECONDS

    def get(self, key: str) -> dict[str, Any] | None:
        now = time.time()
        with self._lock:
            entry = self._memory.get(key)
            if entry is not None:
                expires_at, value = entry
                if now < expires_at:
                    self._memory.move_to_end(key)
                    return value
                del self._memory[key]
        client = self._redis_or_none()
        if client is not None:
            try:
                raw = client.get(key)
            except Exception:
                self._remember_failure()
                raw = None
            if raw:
                try:
                    value = json.loads(raw)
                except (TypeError, ValueError):
                    value = None
                if isinstance(value, dict):
                    self._set_memory(key, value)
                    return value
        return None

    def set(self, key: str, value: dict[str, Any]) -> None:
        self._set_memory(key, value)
        client = self._redis_or_none()
        if client is not None:
            try:
                client.set(key, json.dumps(value, default=str), ex=self._ttl)
            except Exception:
                self._remember_failure()

    def delete(self, key: str) -> None:
        with self._lock:
            self._memory.pop(key, None)
        client = self._redis_or_none()
        if client is not None:
            try:
                client.delete(key)
            except Exception:
                self._remember_failure()

    def _set_memory(self, key: str, value: dict[str, Any]) -> None:
        with self._lock:
            self._memory[key] = (time.time() + self._ttl, value)
            self._memory.move_to_end(key)
            while len(self._memory) > self._max_entries:
                self._memory.popitem(last=False)


@lru_cache(maxsize=1)
def get_sql_cache() -> SQLCache:
    """Shared singleton wired into the SSE stream and the job registry."""
    return SQLCache(redis_url=settings.redis_url or None)
