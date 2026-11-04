import json

import pytest

from app.core.queue import CONSUMER_GROUP, JOB_STREAM
from app.services.job_registry import JobRegistry
from app.workers.consumer import StreamConsumer, parse_message


class FakeRedis:
    """Minimal dict-backed stand-in for the redis-py stream API."""

    def __init__(self):
        self.streams: dict[str, list[tuple[str, dict]]] = {}
        self.groups: set[tuple[str, str]] = set()
        self.acked: list[tuple[str, str, str]] = []
        self._seq = 0

    def xgroup_create(self, stream, group, id="0", mkstream=False):  # noqa: A002
        if (stream, group) in self.groups:
            raise Exception("BUSYGROUP Consumer Group name already exists")
        self.groups.add((stream, group))
        if mkstream:
            self.streams.setdefault(stream, [])

    def xadd(self, stream, fields):
        self._seq += 1
        entry_id = f"{self._seq}-0"
        self.streams.setdefault(stream, []).append((entry_id, dict(fields)))
        return entry_id

    def xreadgroup(self, group, consumer, streams, count=10, block=0):  # noqa: ARG002
        out = []
        for stream in streams:
            entries = self.streams.get(stream, [])[:count]
            self.streams[stream] = self.streams.get(stream, [])[len(entries):]
            if entries:
                out.append((stream, entries))
        return out

    def xack(self, stream, group, entry_id):
        self.acked.append((stream, group, entry_id))
        return 1


def make_consumer():
    redis = FakeRedis()
    consumer = StreamConsumer(redis, JobRegistry(), consumer_name="test-worker")
    consumer.ensure_group()
    return redis, consumer


def test_happy_path_dispatches_and_publishes_result():
    redis, consumer = make_consumer()
    redis.xadd(JOB_STREAM, {"job_id": "j1", "job_type": "forecast",
                            "branch_id": "YGN",
                            "params": json.dumps({"products": [{
                                "product_id": "p1", "daily_sales": [1, 1, 1, 1, 1, 1, 1],
                                "on_hand": 0, "lead_time_days": 1}]})})
    assert consumer.run_once() == 1
    results = redis.streams["ai:results"]
    assert len(results) == 1
    payload = json.loads(results[0][1]["payload"])
    assert payload["ok"] and payload["data"]["suggestions"][0]["product_id"] == "p1"
    assert redis.acked == [(JOB_STREAM, CONSUMER_GROUP, "1-0")]


def test_unknown_job_type_acks_with_error():
    redis, consumer = make_consumer()
    redis.xadd(JOB_STREAM, {"job_id": "j2", "job_type": "nope",
                            "branch_id": "YGN", "params": "{}"})
    assert consumer.run_once() == 1
    payload = json.loads(redis.streams["ai:results"][0][1]["payload"])
    assert not payload["ok"] and "unknown job type" in payload["error"]
    assert len(redis.acked) == 1


def test_poison_message_acks_with_error():
    redis, consumer = make_consumer()
    redis.xadd(JOB_STREAM, {"job_type": "forecast", "branch_id": "YGN",
                            "params": "{not-json"})
    assert consumer.run_once() == 1
    payload = json.loads(redis.streams["ai:results"][0][1]["payload"])
    assert not payload["ok"]
    assert len(redis.acked) == 1  # group never wedges


def test_ensure_group_idempotent():
    redis, consumer = make_consumer()
    consumer.ensure_group()  # BUSYGROUP swallowed


def test_parse_message_validation():
    with pytest.raises(ValueError):
        parse_message({"job_type": "", "branch_id": "YGN", "params": "{}"})
    with pytest.raises(ValueError):
        parse_message({"job_type": "x", "branch_id": "YGN", "params": "[1]"})
    job_id, job_type, branch_id, params = parse_message(
        {"job_type": "forecast", "branch_id": "YGN", "params": '{"a": 1}'})
    assert (job_type, branch_id, params) == ("forecast", "YGN", {"a": 1})
    assert job_id  # auto-generated
