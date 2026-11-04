"""Train the seasonal-trend forecaster from the file artifacts (KDD step ③).

Reads dataset_prepared.csv (never the database), splits the calendar
chronologically into train / validation / test, grid-searches the model
configuration on the validation window, then evaluates the selected model
on the untouched test window against three baselines.

Artifacts written into the run directory:
  model.json      fitted parameters (JSON-serialisable, no pickle)
  metrics.json    MAE / WAPE / non-zero MAE per split + baseline comparison
  steps.json      step-by-step trace (the "real logs" the UI shows)
  manifest.json   sha256 + row counts of every file in the run
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .dataset import load_matrix, prepare_from_csv, sha256_file
from .seasonal import SeasonalModel, fit, predict_range, weekday_indices

TRAIN_SHARE = 0.70
VALIDATION_SHARE = 0.15
DEFAULT_WINDOW_GRID = (3, 7, 14, 21, 28, 56)
DEFAULT_ALPHA_GRID = (0.0, 0.3, 0.7, 1.0)
# How many products keep their actual vs predicted series for the dashboard.
SAMPLE_PRODUCTS = 5


def _mae(pairs: list[tuple[float, float]]) -> float:
    if not pairs:
        return 0.0
    return sum(abs(actual - predicted) for actual, predicted in pairs) / len(pairs)


def _wape(pairs: list[tuple[float, float]]) -> float:
    actual_total = sum(abs(actual) for actual, _ in pairs)
    if actual_total == 0:
        return 0.0
    return sum(abs(actual - predicted) for actual, predicted in pairs) / actual_total


def _non_zero_mae(pairs: list[tuple[float, float]]) -> float:
    subset = [(a, p) for a, p in pairs if a != 0]
    return _mae(subset)


def _baseline_lag1(series: list[float], start: int, end: int) -> list[float]:
    return [series[i - 1] if i > 0 else 0.0 for i in range(start, end)]


def _baseline_ma(window: int):
    def predict(series: list[float], start: int, end: int) -> list[float]:
        out = []
        for i in range(start, end):
            chunk = series[max(0, i - window): i]
            out.append(sum(chunk) / len(chunk) if chunk else 0.0)
        return out

    return predict


def _baseline_lag(period: int):
    def predict(series: list[float], start: int, end: int) -> list[float]:
        return [series[i - period] if i - period >= 0 else 0.0 for i in range(start, end)]

    return predict


def split_bounds(total_days: int) -> tuple[int, int]:
    """Chronological split: train | validation | test (no shuffling)."""
    train_end = int(total_days * TRAIN_SHARE)
    validation_end = int(total_days * (TRAIN_SHARE + VALIDATION_SHARE))
    train_end = max(1, min(train_end, total_days - 2))
    validation_end = max(train_end + 1, min(validation_end, total_days - 1))
    return train_end, validation_end


def evaluate(
    matrix: list[list[float]],
    weekdays: list[int],
    model: SeasonalModel,
    start: int,
    end: int,
    product_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Score the model and every baseline on the same [start, end) window."""
    model_pairs: list[tuple[float, float]] = []
    lag1_pairs: list[tuple[float, float]] = []
    ma7_pairs: list[tuple[float, float]] = []
    lag7_pairs: list[tuple[float, float]] = []
    for index, series in enumerate(matrix):
        product_id = product_ids[index] if product_ids else None
        actual = series[start:end]
        predictions = predict_range(
            series, weekdays, start, end, model, product_id=product_id
        )
        model_pairs.extend(zip(actual, predictions))
        lag1_pairs.extend(zip(actual, _baseline_lag1(series, start, end)))
        ma7_pairs.extend(zip(actual, _baseline_ma(7)(series, start, end)))
        lag7_pairs.extend(zip(actual, _baseline_lag(7)(series, start, end)))
    return {
        "cells": len(model_pairs),
        "model": {
            "mae": _mae(model_pairs),
            "wape": _wape(model_pairs),
            "mae_nonzero_days": _non_zero_mae(model_pairs),
        },
        "baselines": {
            "previous_day": {
                "mae": _mae(lag1_pairs),
                "wape": _wape(lag1_pairs),
                "mae_nonzero_days": _non_zero_mae(lag1_pairs),
            },
            "moving_average_7": {
                "mae": _mae(ma7_pairs),
                "wape": _wape(ma7_pairs),
                "mae_nonzero_days": _non_zero_mae(ma7_pairs),
            },
            "seasonal_naive_7": {
                "mae": _mae(lag7_pairs),
                "wape": _wape(lag7_pairs),
                "mae_nonzero_days": _non_zero_mae(lag7_pairs),
            },
        },
    }


def per_product_mae(
    matrix: list[list[float]],
    weekdays: list[int],
    model: SeasonalModel,
    product_ids: list[str],
    product_names: dict[str, str],
    start: int,
    end: int,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for index, series in enumerate(matrix):
        product_id = product_ids[index]
        actual = series[start:end]
        predictions = predict_range(
            series, weekdays, start, end, model, product_id=product_id
        )
        mae = _mae(list(zip(actual, predictions)))
        out.append({
            "product_id": product_id,
            "product_name": product_names.get(product_id, product_id),
            "mae": round(mae, 4),
        })
    out.sort(key=lambda row: row["mae"])
    return out


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def train(
    run_dir: Path,
    prepared_path: Path,
    *,
    window_grid: tuple[int, ...] = DEFAULT_WINDOW_GRID,
    alpha_grid: tuple[float, ...] = DEFAULT_ALPHA_GRID,
    dataset_meta: dict[str, Any] | None = None,
    activate: bool = True,
    branch_id: str = "",
    branch_code: str = "",
    active_path: Path | None = None,
    on_step: Any = None,
) -> dict[str, Any]:
    """Run the full modeling step and write the run artifacts."""
    steps: list[dict[str, Any]] = []
    run_dir.mkdir(parents=True, exist_ok=True)

    def record(step: dict[str, Any]) -> None:
        steps.append(step)
        if on_step is not None:
            try:
                on_step(step)
            except Exception:  # a broken listener must not fail the training
                pass

    # ---- load -------------------------------------------------------------
    started = time.perf_counter()
    loaded = load_matrix(prepared_path)
    matrix = loaded["matrix"]
    days = loaded["days"]
    weekdays = weekday_indices(days)
    total_cells = len(matrix) * len(days)
    non_zero = sum(1 for row in matrix for v in row if v > 0)
    record({
        "step": "load_dataset", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "products": len(loaded["product_ids"]),
            "days": len(days),
            "cells": total_cells,
            "non_zero_cells": non_zero,
            "sparsity_pct": round((1 - non_zero / total_cells) * 100, 1) if total_cells else 0,
            "mean_qty_per_cell": round(non_zero / total_cells, 4) if total_cells else 0,
            "source": str(prepared_path),
        },
    })

    # ---- split ------------------------------------------------------------
    started = time.perf_counter()
    train_end, validation_end = split_bounds(len(days))
    total = len(days)
    record({
        "step": "chronological_split", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "train": [days[0], days[train_end - 1]],
            "validation": [days[train_end], days[validation_end - 1]],
            "test": [days[validation_end], days[-1]],
            "train_days": train_end,
            "validation_days": validation_end - train_end,
            "test_days": total - validation_end,
            "train_share_pct": round(train_end / total * 100, 1) if total else 0,
            "validation_share_pct": round((validation_end - train_end) / total * 100, 1) if total else 0,
            "test_share_pct": round((total - validation_end) / total * 100, 1) if total else 0,
        },
    })

    # ---- grid search on validation ---------------------------------------
    started = time.perf_counter()
    product_ids = loaded["product_ids"]
    best: tuple[float, int, float] | None = None
    grid_results: list[dict[str, Any]] = []
    for window in window_grid:
        for alpha in alpha_grid:
            pairs: list[tuple[float, float]] = []
            for index, series in enumerate(matrix):
                candidate = fit(
                    series, weekdays, train_end, window=window, alpha=alpha,
                    product_id=product_ids[index],
                )
                actual = series[train_end:validation_end]
                predictions = predict_range(
                    series, weekdays, train_end, validation_end, candidate,
                    product_id=product_ids[index],
                )
                pairs.extend(zip(actual, predictions))
            mae = _mae(pairs)
            grid_results.append({
                "window": window, "alpha": alpha,
                "mae": round(mae, 4),
            })
            if best is None or mae < best[0]:
                best = (mae, window, alpha)
    assert best is not None
    validation_mae, best_window, best_alpha = best
    grid_results.sort(key=lambda row: row["mae"])
    record({
        "step": "grid_search", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "configurations": len(grid_results),
            "window_grid": list(window_grid),
            "alpha_grid": list(alpha_grid),
            "best_window": best_window,
            "best_alpha": best_alpha,
            "best_validation_mae": round(validation_mae, 4),
            "worst_validation_mae": grid_results[-1]["mae"] if grid_results else None,
            "spread": round(grid_results[-1]["mae"] - validation_mae, 4) if grid_results else None,
            "results": grid_results,
        },
    })

    # ---- refit on train+validation ---------------------------------------
    started = time.perf_counter()
    model = SeasonalModel(
        window=best_window,
        alpha=best_alpha,
        train_end=validation_end,
        trained_at=datetime.now(timezone.utc).isoformat(),
    )
    for index, series in enumerate(matrix):
        # Each product keeps its own weekly profile.
        fitted = fit(
            series, weekdays, validation_end, window=best_window, alpha=best_alpha,
            product_id=product_ids[index],
        )
        model.seasonal_by_product[product_ids[index]] = list(fitted.seasonal)
        if index == 0:
            model.seasonal = list(fitted.seasonal)
            model.level_last = fitted.level_last
    refit_days = validation_end
    record({
        "step": "refit_final_model", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "window": best_window,
            "alpha": best_alpha,
            "fit_days": refit_days,
            "products_fitted": len(matrix),
            "level_last": round(model.level_last, 4),
            "seasonal_profile": [round(v, 4) for v in model.seasonal],
            "profile_labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        },
    })

    # ---- evaluate on the untouched test ----------------------------------
    started = time.perf_counter()
    test_metrics = evaluate(
        matrix, weekdays, model, validation_end, len(days), product_ids
    )
    per_product = per_product_mae(
        matrix, weekdays, model, product_ids, loaded["product_names"],
        validation_end, len(days),
    )
    # A few products with their actual vs predicted series over the test
    # window — this is what the dashboard charts.
    test_samples: list[dict[str, Any]] = []
    for index, series in enumerate(matrix[:SAMPLE_PRODUCTS]):
        product_id = product_ids[index]
        actual = series[validation_end:len(days)]
        predicted = predict_range(
            series, weekdays, validation_end, len(days), model, product_id=product_id
        )
        test_samples.append({
            "product_id": product_id,
            "product_name": loaded["product_names"].get(product_id, product_id),
            "days": days[validation_end:],
            "actual": [round(value, 2) for value in actual],
            "predicted": [round(value, 2) for value in predicted],
        })
    baseline_mae = {
        name: round(values["mae"], 4)
        for name, values in test_metrics["baselines"].items()
    }
    model_mae = round(test_metrics["model"]["mae"], 4)
    best_product = per_product[0] if per_product else None
    worst_product = per_product[-1] if per_product else None
    record({
        "step": "evaluate_on_test", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "test_days": [days[validation_end], days[-1]],
            "test_cells": test_metrics["cells"],
            "model_mae": model_mae,
            "model_wape": round(test_metrics["model"]["wape"], 4),
            "model_mae_nonzero": round(test_metrics["model"]["mae_nonzero_days"], 4),
            "baseline_mae": baseline_mae,
            "improvement_vs_baselines": {
                name: round((1 - model_mae / value) * 100, 1) if value else None
                for name, value in baseline_mae.items()
            },
            "best_product": {
                "name": best_product["product_name"],
                "mae": best_product["mae"],
            } if best_product else None,
            "worst_product": {
                "name": worst_product["product_name"],
                "mae": worst_product["mae"],
            } if worst_product else None,
        },
    })

    # ---- write artifacts --------------------------------------------------
    started = time.perf_counter()
    model_path = run_dir / "model.json"
    metrics_path = run_dir / "metrics.json"
    steps_path = run_dir / "steps.json"
    _write_json(model_path, model.to_dict())
    metrics = {
        "test": test_metrics,
        "validation_mae": round(validation_mae, 4),
        "per_product_mae": per_product,
        "test_samples": test_samples,
        "split": {
            "train": [days[0], days[train_end - 1]],
            "validation": [days[train_end], days[validation_end - 1]],
            "test": [days[validation_end], days[-1]],
        },
        "dataset": dataset_meta or {},
    }
    _write_json(metrics_path, metrics)
    record({
        "step": "write_artifacts", "status": "ok",
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "detail": {
            "run_dir": str(run_dir),
            "artifacts": ["model.json", "metrics.json"],
        },
    })

    if activate:
        # The active pointer lives at the artifact root (not inside runs/).
        started = time.perf_counter()
        target = active_path or (run_dir.parent.parent / "active.json")
        _write_json(target, {
            "run_dir": str(run_dir),
            "branch_id": branch_id,
            "branch_code": branch_code,
            "model": model.to_dict(),
            "metrics": {
                "test_mae": test_metrics["model"]["mae"],
                "baseline_mae": {
                    name: values["mae"]
                    for name, values in test_metrics["baselines"].items()
                },
            },
            "trained_at": model.trained_at,
        })
        record({
            "step": "activate_model", "status": "ok",
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "detail": {
                "active_path": str(target),
                "branch_code": branch_code,
                "test_mae": round(test_metrics["model"]["mae"], 4),
            },
        })

    # steps.json + manifest.json are written LAST so they include every
    # recorded step (write_artifacts, activate_model).
    _write_json(steps_path, {"steps": steps})
    manifest = {
        "run_dir": str(run_dir),
        "branch_id": branch_id,
        "branch_code": branch_code,
        "prepared_dataset": {
            "path": str(prepared_path),
            "sha256": sha256_file(prepared_path),
            "bytes": prepared_path.stat().st_size,
        },
        "model": {"path": str(model_path), "sha256": sha256_file(model_path)},
        "metrics": {"path": str(metrics_path), "sha256": sha256_file(metrics_path)},
        "steps": {"path": str(steps_path), "sha256": sha256_file(steps_path)},
        "trained_at": model.trained_at,
    }
    _write_json(run_dir / "manifest.json", manifest)

    return {
        "model": model.to_dict(),
        "metrics": metrics,
        "steps": steps,
        "manifest": manifest,
    }


def prepare_and_train(
    artifact_dir: Path,
    raw_path: Path,
    *,
    run_name: str,
    window_grid: tuple[int, ...] = DEFAULT_WINDOW_GRID,
    alpha_grid: tuple[float, ...] = DEFAULT_ALPHA_GRID,
    activate: bool = True,
    branch_id: str = "",
    branch_code: str = "",
) -> dict[str, Any]:
    """Convenience wrapper: prepare the raw file, then train from it."""
    prepared_path = artifact_dir / "dataset_prepared.csv"
    dataset_meta = prepare_from_csv(raw_path, prepared_path)
    run_dir = artifact_dir / "runs" / run_name
    return train(
        run_dir, prepared_path,
        window_grid=window_grid, alpha_grid=alpha_grid,
        dataset_meta=dataset_meta, activate=activate,
        branch_id=branch_id, branch_code=branch_code,
        active_path=artifact_dir / "active.json",
    )
