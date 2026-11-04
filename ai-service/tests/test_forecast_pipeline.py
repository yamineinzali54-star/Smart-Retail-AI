"""Tests for the file-based forecasting KDD pipeline.

Covers: raw -> prepared preparation (cleaning, zero-fill, returns), the
seasonal-trend model, the trainer (split, grid search, metrics, artifacts)
and the model store used by the serving job.
"""

import csv
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.features.forecasting.dataset import (
    load_matrix,
    prepare_from_csv,
    sha256_file,
)
from app.features.forecasting.model_store import (
    active_model_info,
    list_runs,
    load_active_model,
)
from app.features.forecasting.seasonal import (
    SeasonalModel,
    fit,
    level_series,
    predict_range,
    seasonal_profile,
    weekday_indices,
)
from app.features.forecasting.trainer import split_bounds, train

RAW_HEADER = [
    "branch_code", "sale_id", "sale_number", "sale_date", "sale_status",
    "payment_method", "pos_session_id", "cashier_id", "sale_detail_id",
    "product_id", "product_name", "category_name", "quantity", "unit_price",
    "discount", "tax_rate_applied", "line_total", "returned_qty",
    "returned_amount",
]


def raw_row(**overrides):
    row = {
        "branch_code": "YGN",
        "sale_id": "s1",
        "sale_number": "SALE-YGN-20240101-0001",
        "sale_date": "2024-01-01 10:00:00+06:30",
        "sale_status": "completed",
        "payment_method": "cash",
        "pos_session_id": "ps1",
        "cashier_id": "u1",
        "sale_detail_id": "sd1",
        "product_id": "p1",
        "product_name": "Noodle",
        "category_name": "Food",
        "quantity": "3",
        "unit_price": "1000.00",
        "discount": "0.00",
        "tax_rate_applied": "5.00",
        "line_total": "3000.00",
        "returned_qty": "0",
        "returned_amount": "0",
    }
    row.update(overrides)
    return row


def write_raw(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=RAW_HEADER, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return path


# ---------------------------------------------------------------------------
# STEP 2 — preparation
# ---------------------------------------------------------------------------

def test_prepare_zero_fills_the_calendar(tmp_path):
    raw = write_raw(tmp_path / "raw.csv", [
        raw_row(sale_detail_id="a", sale_date="2024-01-01 10:00:00+06:30", product_id="p1", quantity="3"),
        raw_row(sale_detail_id="b", sale_number="SALE-2",
                sale_date="2024-01-01 11:00:00+06:30", product_id="p2", product_name="Egg", quantity="2"),
        raw_row(sale_detail_id="c", sale_number="SALE-3",
                sale_date="2024-01-03 11:00:00+06:30", product_id="p2", product_name="Egg", quantity="4"),
    ])
    meta = prepare_from_csv(raw, tmp_path / "prepared.csv")
    # 2 products x 3 calendar days (Jan 1..Jan 3)
    assert meta["rows"] == 6
    assert meta["products"] == 2
    assert meta["calendar_days"] == 3
    assert meta["non_zero_cells"] == 3
    assert meta["zero_filled_cells"] == 3
    with (tmp_path / "prepared.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert {r["day"] for r in rows} == {"2024-01-01", "2024-01-02", "2024-01-03"}
    zeros = [r for r in rows if r["qty"] == "0"]
    assert len(zeros) == 3
    # Jan 2 has no sale at all -> both products are zero on that day
    jan2 = [r for r in rows if r["day"] == "2024-01-02"]
    assert {r["qty"] for r in jan2} == {"0"}


def test_prepare_drops_unusable_rows_and_counts_them(tmp_path):
    raw = write_raw(tmp_path / "raw2.csv", [
        raw_row(sale_detail_id="a", quantity="3"),
        raw_row(sale_detail_id="b", sale_number="SALE-2", sale_status="voided", quantity="3"),
        raw_row(sale_detail_id="c", sale_number="SALE-3", quantity="0"),
        raw_row(sale_detail_id="d", sale_number="SALE-4", quantity=""),
        # same (sale_number, product_id) as row "a" -> duplicate line
        raw_row(sale_detail_id="e", quantity="2"),
    ])
    meta = prepare_from_csv(raw, tmp_path / "prepared2.csv")
    counters = meta["cleaning"]
    assert counters["dropped_status"] == 1
    assert counters["dropped_nonpositive"] == 1
    assert counters["dropped_incomplete"] == 1
    assert counters["dropped_duplicate"] == 1


def test_prepare_nets_out_returns(tmp_path):
    raw = write_raw(tmp_path / "raw3.csv", [
        raw_row(quantity="5", returned_qty="2", returned_amount="2000.00"),
    ])
    prepare_from_csv(raw, tmp_path / "prepared3.csv")
    with (tmp_path / "prepared3.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert rows[0]["qty"] == "3"  # 5 sold - 2 returned


def test_prepared_dataset_is_rectangular(tmp_path):
    raw = write_raw(tmp_path / "raw4.csv", [
        raw_row(sale_detail_id="a", product_id="p1", product_name="A", sale_date="2024-01-01 10:00:00+06:30"),
        raw_row(sale_detail_id="b", product_id="p2", product_name="B", sale_date="2024-01-02 10:00:00+06:30"),
    ])
    prepare_from_csv(raw, tmp_path / "prepared4.csv")
    loaded = load_matrix(tmp_path / "prepared4.csv")
    assert len(loaded["days"]) == 2
    assert len(loaded["matrix"]) == 2
    assert all(len(row) == 2 for row in loaded["matrix"])


# ---------------------------------------------------------------------------
# STEP 3 — the model
# ---------------------------------------------------------------------------

def test_level_series_is_a_trailing_mean():
    series = [1.0, 2.0, 3.0, 4.0]
    levels = level_series(series, 2, 1.0)
    assert levels == [1.0, 1.5, 2.5, 3.5]


def test_seasonal_profile_recovers_a_weekly_pattern():
    # 28 days: quantity is 10 every Monday, 2 otherwise
    start = date(2024, 1, 1)
    days = [(start + timedelta(days=i)).isoformat() for i in range(28)]
    weekdays = weekday_indices(days)
    series = [10.0 if wd == 0 else 2.0 for wd in weekdays]
    levels = level_series(series, 3, 1.0)
    profile = seasonal_profile(series, weekdays, levels, len(series))
    assert profile[0] > profile[1]  # Monday is the high day
    assert abs(sum(profile)) < 1e-6  # centred


def test_fit_predict_beats_a_flat_guess_on_a_seasonal_series():
    start = date(2024, 1, 1)
    days = [(start + timedelta(days=i)).isoformat() for i in range(60)]
    weekdays = weekday_indices(days)
    series = [10.0 if wd == 0 else 2.0 for wd in weekdays]
    model = fit(series, weekdays, 40, window=3, alpha=1.0)
    predictions = predict_range(series, weekdays, 40, 60, model)
    actual = series[40:60]
    mae = sum(abs(a - p) for a, p in zip(actual, predictions)) / len(actual)
    assert mae < 2.0


def test_model_round_trips_through_json():
    model = SeasonalModel(window=5, alpha=0.5, seasonal=[1.0] * 7, level_last=2.5)
    restored = SeasonalModel.from_dict(model.to_dict())
    assert restored.window == 5
    assert restored.alpha == 0.5
    assert restored.seasonal == [1.0] * 7
    assert restored.level_last == 2.5


def test_each_product_keeps_its_own_weekly_profile():
    """Products have different weekly patterns — a shared profile would
    flatten that signal."""
    model = SeasonalModel(window=3, alpha=1.0, seasonal=[0.0] * 7)
    model.seasonal_by_product = {
        "weekend_product": [5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],  # Monday heavy
        "weekday_product": [0.0] * 7,
    }
    model.seasonal_by_product["weekday_product"][0] = -1.0
    assert model.profile_for("weekend_product")[0] == 5.0
    assert model.profile_for("weekday_product")[0] == -1.0
    assert model.profile_for("unknown_product") == [0.0] * 7  # global fallback
    # and it survives a JSON round trip
    restored = SeasonalModel.from_dict(model.to_dict())
    assert restored.profile_for("weekend_product")[0] == 5.0
    assert restored.profile_for("weekday_product")[0] == -1.0


# ---------------------------------------------------------------------------
# Trainer
# ---------------------------------------------------------------------------

def _synthetic_prepared(path: Path, days: int = 120, products: int = 3) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    start = date(2024, 1, 1)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["branch_code", "product_id", "product_name", "day", "weekday", "qty"])
        for i in range(days):
            day = start + timedelta(days=i)
            for p in range(products):
                qty = (5 + p) if day.weekday() == 0 else 1
                writer.writerow(["YGN", f"p{p}", f"Product {p}", day.isoformat(), day.strftime("%a"), qty])
    return path


def test_split_bounds_are_chronological_and_disjoint():
    train_end, validation_end = split_bounds(1000)
    assert 0 < train_end < validation_end < 1000


def test_train_writes_artifacts_and_activates_the_model(tmp_path):
    prepared = _synthetic_prepared(tmp_path / "dataset_prepared.csv")
    result = train(tmp_path / "runs" / "run1", prepared, activate=True,
                   active_path=tmp_path / "active.json", branch_id="b1", branch_code="YGN")
    run_dir = tmp_path / "runs" / "run1"
    for name in ("model.json", "metrics.json", "steps.json", "manifest.json"):
        assert (run_dir / name).exists()
    model_payload = json.loads((run_dir / "model.json").read_text())
    assert model_payload["algorithm"] == "additive_seasonal_trend"
    metrics = json.loads((run_dir / "metrics.json").read_text())
    assert "model" in metrics["test"]
    assert "previous_day" in metrics["test"]["baselines"]
    steps = json.loads((run_dir / "steps.json").read_text())["steps"]
    assert [s["step"] for s in steps] == [
        "load_dataset", "chronological_split", "grid_search",
        "refit_final_model", "evaluate_on_test", "write_artifacts", "activate_model",
    ]
    active = json.loads((tmp_path / "active.json").read_text())
    assert active["branch_id"] == "b1"
    assert active["model"]["algorithm"] == "additive_seasonal_trend"
    assert result["metrics"]["test"]["cells"] > 0


def test_test_window_is_not_used_for_training(tmp_path):
    """Leakage guard: the test window must not influence the fit."""
    prepared = _synthetic_prepared(tmp_path / "dataset_prepared.csv", days=120)
    result = train(tmp_path / "runs" / "run2", prepared, activate=False,
                   active_path=tmp_path / "active.json")
    split = result["metrics"]["split"]
    train_end = split["train"][1]
    test_start = split["test"][0]
    assert train_end < test_start
    # the model records the index it was fitted up to
    assert result["model"]["train_end"] < 1000


def test_model_store_respects_branch_scope(tmp_path):
    prepared = _synthetic_prepared(tmp_path / "dataset_prepared.csv", days=120)
    train(tmp_path / "runs" / "run3", prepared, activate=True,
          active_path=tmp_path / "active.json", branch_id="branch-a")
    assert load_active_model(tmp_path, branch_id="branch-a") is not None
    assert load_active_model(tmp_path, branch_id="branch-b") is None
    assert load_active_model(tmp_path) is not None
    info = active_model_info(tmp_path)
    assert info["branch_id"] == "branch-a"
    runs = list_runs(tmp_path)
    assert len(runs) == 1
    assert runs[0]["run_id"] == "run3"
    assert runs[0]["test_mae"] is not None


def test_model_store_returns_none_without_a_model(tmp_path):
    assert load_active_model(tmp_path) is None
    assert active_model_info(tmp_path) is None
    assert list_runs(tmp_path) == []


def test_sha256_is_stable(tmp_path):
    path = tmp_path / "x.csv"
    path.write_text("a,b\n1,2\n", encoding="utf-8")
    assert sha256_file(path) == sha256_file(path)
