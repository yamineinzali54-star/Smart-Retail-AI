from app.services.job_registry import JobRegistry
from app.workers import tasks
from app.workers.celery_app import celery


class FakeDb:
    """Routes branch lookups and nightly job queries to canned rows."""

    def __init__(self, branch_id="branch-1", rows=None, error=None):
        self._branch_id = branch_id
        self._rows = rows if rows is not None else []
        self._error = error
        self.seen: list[tuple] = []

    def fetch_all(self, sql, params=()):
        self.seen.append((sql, params))
        if self._error:
            raise RuntimeError(self._error)
        if "FROM branch" in sql:
            return [] if self._branch_id is None else [{"id": self._branch_id}]
        return self._rows


def patch_services(monkeypatch, db):
    from app.core.llm.base import StubLLMProvider

    monkeypatch.setattr(tasks, "get_db", lambda: db)
    monkeypatch.setattr(tasks, "get_registry",
                        lambda: JobRegistry(StubLLMProvider("narrated."), db))


def test_nightly_forecast_forwards_params(monkeypatch):
    seen = {}

    class SpyDb(FakeDb):
        def fetch_all(self, sql, params=()):
            seen.setdefault("params", []).append(params)
            return super().fetch_all(sql, params)

    patch_services(monkeypatch, SpyDb(rows=[]))
    result = tasks.nightly_forecast("YGN", 7)
    assert result["ok"] and result["job"] == "forecast_build"
    flat = [v for p in seen["params"] for v in p]
    assert flat.count("YGN") == 1  # only the branch lookup uses the code
    assert ("branch-1", "7") in seen["params"]  # sales window forwarded
    assert ("branch-1",) in seen["params"]  # stock lookup


def test_unknown_branch_fails_closed(monkeypatch):
    patch_services(monkeypatch, FakeDb(branch_id=None))
    result = tasks.nightly_basket("XXX")
    assert not result["ok"] and "branch not found" in result["error"]


def test_db_error_fails_closed(monkeypatch):
    patch_services(monkeypatch, FakeDb(error="down"))
    result = tasks.nightly_alerts("YGN")
    assert not result["ok"]


def test_beat_schedule_covers_four_tasks():
    assert celery is not None
    schedule = celery.conf.beat_schedule
    assert len(schedule) == 4
    by_task = {entry["task"]: entry for entry in schedule.values()}
    assert set(by_task) == {
        "ai.nightly_forecast", "ai.nightly_basket", "ai.nightly_alerts",
        "ai.weekly_forecast_train",
    }
    assert all(entry["args"] == ["YGN"] for entry in by_task.values())
    assert celery.conf.timezone == "Asia/Yangon"


def test_weekly_forecast_train_runs_sunday_midnight():
    # The supervisor asks for a weekly retrain on Sunday 00:00.
    entry = {
        item["task"]: item
        for item in celery.conf.beat_schedule.values()
    }["ai.weekly_forecast_train"]
    schedule = entry["schedule"]
    assert schedule.hour == {0}
    assert schedule.minute == {0}
    assert schedule.day_of_week == {0}  # Sunday
