"""Celery app factory. Import is lazy so the API + tests run without a
broker. Start a worker with: celery -A app.workers.celery_app:celery worker -l info"""

from __future__ import annotations


def make_celery():  # type: ignore[no-untyped-def]
    from celery import Celery
    from celery.schedules import crontab

    from app.config import settings

    app = Celery("smartretail_ai", broker=settings.redis_url)
    app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])
    # Nightly 2 AM Myanmar time. One entry per (task, branch code) so new
    # branches join by extending NIGHTLY_BRANCH_CODES only.
    app.conf.timezone = "Asia/Yangon"
    app.conf.enable_utc = True
    codes = [c.strip() for c in settings.nightly_branch_codes.split(",") if c.strip()]
    beat_schedule = {}
    for code in codes:
        beat_schedule[f"nightly-forecast-{code}"] = {
            "task": "ai.nightly_forecast",
            "schedule": crontab(hour=2, minute=0),
            "args": [code],
        }
        beat_schedule[f"nightly-basket-{code}"] = {
            "task": "ai.nightly_basket",
            "schedule": crontab(hour=2, minute=5),
            "args": [code],
        }
        beat_schedule[f"nightly-alerts-{code}"] = {
            "task": "ai.nightly_alerts",
            "schedule": crontab(hour=2, minute=15),
            "args": [code],
        }
        # Weekly retrain of the demand forecaster: Sunday 00:00 Myanmar time.
        # The model produced here serves the coming week (active.json).
        beat_schedule[f"weekly-forecast-train-{code}"] = {
            "task": "ai.weekly_forecast_train",
            "schedule": crontab(day_of_week=0, hour=0, minute=0),
            "args": [code],
        }
        beat_schedule[f"weekly-revenue-forecast-train-{code}"] = {
            "task": "ai.weekly_revenue_forecast_train",
            "schedule": crontab(day_of_week=0, hour=0, minute=15),
            "args": [code],
        }
    app.conf.beat_schedule = beat_schedule
    return app


try:
    celery = make_celery()
except Exception:  # celery/redis unavailable in dev — API still works
    celery = None  # type: ignore[assignment]
