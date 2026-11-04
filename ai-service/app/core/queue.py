"""Redis Streams transport (PROJECT_PLAN.md §6.12). Lazy import so tests
run without Redis. Two roles:

- Producers (Next.js / API): `enqueue_job` puts {job_type, branch_id, params}
  on the JOB stream.
- `workers/consumer.py`: XREADGROUP dispatch via the JobRegistry, results go
  back on the RESULT stream (plus XACK so poison messages can't wedge it).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

JOB_STREAM = "ai:jobs"
RESULT_STREAM = "ai:results"
CONSUMER_GROUP = "ai-workers"


def connect(url: str):  # type: ignore[no-untyped-def]
    import redis

    return redis.Redis.from_url(url, decode_responses=True)


class StreamQueue:
    def __init__(self, url: str):
        self._url = url
        self._client = None

    def _client_or_connect(self):  # type: ignore[no-untyped-def]
        if self._client is None:
            self._client = connect(self._url)
        return self._client

    def enqueue(self, stream: str, payload: dict[str, Any]) -> str:
        client = self._client_or_connect()
        entry_id = client.xadd(stream, {k: str(v) for k, v in payload.items()})
        return str(entry_id)

    def enqueue_job(
        self,
        job_type: str,
        branch_id: str,
        params: dict[str, Any] | None = None,
        *,
        stream: str = JOB_STREAM,
        job_id: str | None = None,
    ) -> str:
        return self.enqueue(stream, {
            "job_id": job_id or uuid4().hex,
            "job_type": job_type,
            "branch_id": branch_id,
            "params": json.dumps(params or {}),
        })
