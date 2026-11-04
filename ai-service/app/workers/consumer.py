"""Redis Streams consumer (§6.12 transport). Reads jobs with XREADGROUP,
dispatches through the JobRegistry (the same code path as the API), publishes
results on the RESULT stream, and ACKs every message — including failures —
so one poison message can never wedge the group.

Run: python -m app.workers.consumer   (needs REDIS_URL + AI_DATABASE_URL)
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any
from uuid import uuid4

from app.core.base_job import JobContext, JobResult
from app.core.queue import CONSUMER_GROUP, JOB_STREAM, RESULT_STREAM, connect
from app.services.factory import get_registry
from app.services.job_registry import JobRegistry

log = logging.getLogger("ai.consumer")


def parse_message(fields: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    """Returns (job_id, job_type, branch_id, params). Raises ValueError."""
    try:
        params = json.loads(fields.get("params", "{}"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid params JSON: {exc}") from None
    if not isinstance(params, dict):
        raise ValueError("params must be a JSON object")
    job_type = str(fields.get("job_type", ""))
    branch_id = str(fields.get("branch_id", ""))
    if not job_type or not branch_id:
        raise ValueError("job_type and branch_id are required")
    return str(fields.get("job_id", "") or uuid4().hex), job_type, branch_id, params


class StreamConsumer:
    def __init__(
        self,
        client: Any,
        registry: JobRegistry,
        *,
        consumer_name: str | None = None,
        result_stream: str = RESULT_STREAM,
    ):
        self._client = client
        self._registry = registry
        self._result_stream = result_stream
        self._consumer = consumer_name or f"worker-{uuid4().hex[:8]}"

    def ensure_group(self, stream: str = JOB_STREAM) -> None:
        try:
            self._client.xgroup_create(stream, CONSUMER_GROUP, id="0", mkstream=True)
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    def run_once(self, stream: str = JOB_STREAM, *, count: int = 10,
                 block_ms: int = 2000) -> int:
        messages = self._client.xreadgroup(
            CONSUMER_GROUP, self._consumer, {stream: ">"}, count=count, block=block_ms
        ) or []
        processed = 0
        for _, entries in messages:
            for entry_id, fields in entries:
                self._handle(stream, entry_id, fields)
                processed += 1
        return processed

    def _handle(self, stream: str, entry_id: str, fields: dict[str, Any]) -> None:
        try:
            job_id, job_type, branch_id, params = parse_message(fields)
        except ValueError as exc:
            self._publish({"job_id": "", "ok": False, "job": "",
                           "data": {}, "error": str(exc)})
            self._client.xack(stream, CONSUMER_GROUP, entry_id)
            return
        try:
            job = self._registry.create(job_type)
        except (KeyError, ValueError) as exc:
            result = JobResult(job_id=job_id, job_name="", ok=False, error=str(exc))
        else:
            result = job.execute(JobContext(job_id=job_id, branch_id=branch_id, params=params))
        self._publish({"job_id": result.job_id, "ok": result.ok, "job": result.job_name,
                       "data": result.data, "error": result.error or ""})
        self._client.xack(stream, CONSUMER_GROUP, entry_id)

    def _publish(self, result: dict[str, Any]) -> None:
        self._client.xadd(self._result_stream, {
            "job_id": str(result.get("job_id", "")),
            "payload": json.dumps(result, default=str),
        })

    def run_forever(self, stream: str = JOB_STREAM, *, poll_interval: float = 1.0) -> None:
        self.ensure_group(stream)
        log.info("consumer %s listening on %s", self._consumer, stream)
        while True:
            try:
                self.run_once(stream)
            except Exception:  # noqa: BLE001 — never let the loop die
                log.exception("consumer error; retrying")
                time.sleep(poll_interval)


def main() -> None:
    from app.config import settings

    logging.basicConfig(level=logging.INFO)
    consumer = StreamConsumer(connect(settings.redis_url), get_registry())
    consumer.run_forever()


if __name__ == "__main__":
    main()
