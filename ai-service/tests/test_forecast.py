from app.core.base_job import JobContext
from app.features.forecasting.forecaster import DemandForecaster, ForecastJob


def test_moving_average_last_window():
    f = DemandForecaster()
    assert f.moving_average([10, 12, 11, 13, 12, 14, 13], window=3) == 13.0


def test_suggest_reorder_math():
    f = DemandForecaster()
    # 13/day * (7 lead + 3 safety) - 50 on hand = 80
    assert f.suggest_reorder(avg_daily_sales=13, lead_time_days=7, on_hand=50) == 80.0
    assert f.suggest_reorder(avg_daily_sales=1, lead_time_days=7, on_hand=500) == 0.0


def test_job_skips_thin_history():
    job = ForecastJob()
    result = job.execute(JobContext(branch_id="YGN", params={"products": [
        {"product_id": "p1", "daily_sales": [5, 6], "on_hand": 100, "lead_time_days": 7},
    ]}))
    assert result.ok and result.data["suggestions"] == []


def test_job_suggests_for_good_history():
    job = ForecastJob()
    result = job.execute(JobContext(branch_id="YGN", params={"products": [
        {"product_id": "p1", "daily_sales": [10, 12, 11, 13, 12, 14, 13],
         "on_hand": 50, "lead_time_days": 7},
    ]}))
    assert result.ok
    (s,) = result.data["suggestions"]
    # 7-day avg of [10,12,11,13,12,14,13] = 85/7 ≈ 12.14; 12.14*(7+3) - 50 = 71.43
    assert s["product_id"] == "p1" and s["suggested_qty"] == 71.43 and s["needs_order"]
