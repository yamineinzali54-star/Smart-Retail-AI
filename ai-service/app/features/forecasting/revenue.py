"""Weekly net-revenue forecasts, kept separate from unit-demand forecasting.

Revenue is sale-detail line totals less approved returns, grouped by the week
in which the sale or return occurred. XGBoost features use observed history
strictly before the target week, so backtests do not see the target value.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from xgboost import XGBRegressor
from xgboost.core import XGBoostError

from app.config import settings
from app.core.db import Database

MIN_WEEKS = 40
FORECAST_HORIZON = 4
TOP_PRODUCTS = 10
FEATURES = (
    "lag_1", "lag_2", "lag_4", "mean_4", "mean_12",
    "week_sin", "week_cos", "trend",
)
PARAMETER_GRID = (
    {"n_estimators": 60, "max_depth": 2, "learning_rate": 0.04},
    {"n_estimators": 100, "max_depth": 2, "learning_rate": 0.05},
    {"n_estimators": 80, "max_depth": 3, "learning_rate": 0.04},
)

SALES_SQL = """
SELECT date_trunc('week', s.sale_date)::date AS week,
       sd.product_id,
       p.name AS product_name,
       SUM(sd.line_total)::double precision AS amount
FROM sale_detail sd
JOIN sale s ON s.id = sd.sale_id
JOIN products p ON p.id = sd.product_id AND p.is_deleted = false
WHERE s.branch_id = %s AND s.status = 'completed'
  AND s.sale_date < date_trunc('week', NOW())
GROUP BY 1, 2, 3
ORDER BY 1
"""

TOTAL_SALES_SQL = """
SELECT date_trunc('week', s.sale_date)::date AS week,
       SUM(sd.line_total)::double precision AS amount
FROM sale_detail sd
JOIN sale s ON s.id = sd.sale_id
WHERE s.branch_id = %s AND s.status = 'completed'
  AND s.sale_date < date_trunc('week', NOW())
GROUP BY 1
ORDER BY 1
"""

REFUNDS_SQL = """
SELECT date_trunc('week', sr.created_at)::date AS week,
       sd.product_id,
       SUM(srd.refund_amount)::double precision AS amount
FROM sale_return_detail srd
JOIN sale_return sr ON sr.id = srd.return_id AND sr.status = 'approved'
JOIN sale_detail sd ON sd.id = srd.sale_detail_id
WHERE sr.branch_id = %s
  AND sr.created_at < date_trunc('week', NOW())
GROUP BY 1, 2
ORDER BY 1
"""

TOTAL_REFUNDS_SQL = """
SELECT date_trunc('week', sr.created_at)::date AS week,
       SUM(srd.refund_amount)::double precision AS amount
FROM sale_return_detail srd
JOIN sale_return sr ON sr.id = srd.return_id AND sr.status = 'approved'
WHERE sr.branch_id = %s
  AND sr.created_at < date_trunc('week', NOW())
GROUP BY 1
ORDER BY 1
"""

CURRENT_WEEK_SQL = "SELECT date_trunc('week', NOW())::date AS week"
SALES_HISTORY_COUNT_SQL = """
SELECT COUNT(DISTINCT date_trunc('week', s.sale_date))::int AS weeks
FROM sale s
JOIN sale_detail sd ON sd.sale_id = s.id
WHERE s.branch_id = %s AND s.status = 'completed'
  AND s.sale_date < date_trunc('week', NOW())
"""

ProgressCallback = Callable[[str, str, dict[str, Any]], None]


def _notify(
    callback: ProgressCallback | None,
    step: str,
    status: str,
    detail: dict[str, Any] | None = None,
) -> None:
    if callback:
        callback(step, status, detail or {})


def _week_string(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value)[:10]


def _collect(
    db: Database,
    branch_id: str,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    _notify(on_progress, "collect_sales", "running", {"message": "Querying completed sale lines"})
    sales = db.fetch_all(SALES_SQL, (branch_id,))
    _notify(on_progress, "collect_sales", "ok", {"rows": len(sales)})
    _notify(on_progress, "collect_refunds", "running", {"message": "Querying approved returns"})
    refunds = db.fetch_all(REFUNDS_SQL, (branch_id,))
    _notify(on_progress, "collect_refunds", "ok", {"rows": len(refunds)})
    _notify(on_progress, "collect_totals", "running", {"message": "Querying branch weekly totals"})
    total_sales = db.fetch_all(TOTAL_SALES_SQL, (branch_id,))
    total_refunds = db.fetch_all(TOTAL_REFUNDS_SQL, (branch_id,))
    current_week_rows = db.fetch_all(CURRENT_WEEK_SQL)
    _notify(on_progress, "collect_totals", "ok", {"sales_weeks": len(total_sales), "refund_weeks": len(total_refunds)})
    gross: dict[tuple[str, str], float] = {}
    refund_totals: dict[tuple[str, str], float] = {}
    names: dict[str, str] = {}
    weeks: set[str] = set()
    for row in sales:
        week = _week_string(row["week"])
        product_id = str(row["product_id"])
        key = (week, product_id)
        gross[key] = gross.get(key, 0.0) + float(row.get("amount") or 0)
        names[product_id] = str(row.get("product_name") or product_id)
        weeks.add(week)
    for row in refunds:
        week = _week_string(row["week"])
        product_id = str(row["product_id"])
        key = (week, product_id)
        refund_totals[key] = refund_totals.get(key, 0.0) + float(row.get("amount") or 0)
        weeks.add(week)

    gross_total_by_week: dict[str, float] = {}
    refund_total_by_week: dict[str, float] = {}
    for row in total_sales:
        week = _week_string(row["week"])
        gross_total_by_week[week] = float(row.get("amount") or 0)
        weeks.add(week)
    for row in total_refunds:
        week = _week_string(row["week"])
        refund_total_by_week[week] = float(row.get("amount") or 0)
        weeks.add(week)

    observed_weeks = sorted(weeks)
    if not observed_weeks:
        _notify(on_progress, "validate_history", "error", {"weeks_found": 0, "weeks_required": MIN_WEEKS})
        raise ValueError(f"At least {MIN_WEEKS} weeks of sales history are required; found 0")
    sales_weeks = len(gross_total_by_week)
    _notify(on_progress, "validate_history", "running", {"weeks_found": sales_weeks, "weeks_required": MIN_WEEKS})
    if sales_weeks < MIN_WEEKS:
        _notify(on_progress, "validate_history", "error", {"weeks_found": sales_weeks, "weeks_required": MIN_WEEKS})
        raise ValueError(f"At least {MIN_WEEKS} weeks of sales history are required; found {sales_weeks}")
    _notify(on_progress, "validate_history", "ok", {"weeks_found": sales_weeks, "weeks_required": MIN_WEEKS})
    _notify(on_progress, "prepare_dataset", "running", {"message": "Filling missing weeks and calculating net revenue"})
    first = date.fromisoformat(observed_weeks[0])
    last_observed = date.fromisoformat(observed_weeks[-1])
    current_week = date.fromisoformat(_week_string(current_week_rows[0]["week"]))
    last_complete_week = date.fromordinal(current_week.toordinal() - 7)
    last = max(last_observed, last_complete_week)
    calendar: list[str] = []
    cursor = first
    while cursor <= last:
        calendar.append(cursor.isoformat())
        cursor = date.fromordinal(cursor.toordinal() + 7)

    product_ids = sorted(names)
    product_series = {
        product_id: [
            gross.get((week, product_id), 0.0) - refund_totals.get((week, product_id), 0.0)
            for week in calendar
        ]
        for product_id in product_ids
    }
    total_series = [
        gross_total_by_week.get(week, 0.0) - refund_total_by_week.get(week, 0.0)
        for week in calendar
    ]
    _notify(on_progress, "prepare_dataset", "ok", {"weeks": len(calendar), "products": len(product_ids)})
    return {
        "weeks": calendar,
        "sales_weeks": sales_weeks,
        "total": total_series,
        "products": product_series,
        "product_names": names,
    }


def _features(history: list[float], target_week: str, target_index: int) -> list[float]:
    if len(history) < 12:
        raise ValueError("At least 12 weeks of history are required")
    target_date = date.fromisoformat(target_week)
    week_number = target_date.isocalendar().week
    return [
        history[-1],
        history[-2],
        history[-4],
        sum(history[-4:]) / 4,
        sum(history[-12:]) / 12,
        math.sin(2 * math.pi * week_number / 52.1775),
        math.cos(2 * math.pi * week_number / 52.1775),
        target_index / 52.1775,
    ]


def _training_rows(series: list[float], weeks: list[str], end: int) -> tuple[list[list[float]], list[float]]:
    x: list[list[float]] = []
    y: list[float] = []
    for index in range(12, min(end, len(series))):
        x.append(_features(series[:index], weeks[index], index))
        y.append(float(series[index]))
    return x, y


def _model(parameters: dict[str, Any]) -> XGBRegressor:
    return XGBRegressor(
        objective="reg:squarederror",
        eval_metric="mae",
        random_state=42,
        n_jobs=1,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=2.0,
        **parameters,
    )


def _mae(actual: list[float], predicted: list[float]) -> float:
    if not actual:
        return 0.0
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)


def _metrics(actual: list[float], predicted: list[float]) -> dict[str, float | int | None]:
    pairs = list(zip(actual, predicted))
    total = sum(abs(a) for a, _ in pairs)
    nonzero = [(a, p) for a, p in pairs if a != 0]
    return {
        "weeks": len(pairs),
        "mae": round(_mae(actual, predicted), 2),
        "wape_pct": round(100 * sum(abs(a - p) for a, p in pairs) / total, 2) if total else None,
        "mape_nonzero_pct": round(
            100 * sum(abs(a - p) / abs(a) for a, p in nonzero) / len(nonzero), 2,
        ) if nonzero else None,
    }


def _predict_rolling(model: XGBRegressor, series: list[float], weeks: list[str], start: int, end: int) -> list[float]:
    return [
        max(0.0, float(model.predict([_features(series[:index], weeks[index], index)])[0]))
        for index in range(start, end)
    ]


def _moving_average_predictions(series: list[float], start: int, end: int, window: int) -> list[float]:
    result: list[float] = []
    for index in range(start, end):
        history = series[max(0, index - window):index]
        result.append(sum(history) / len(history) if history else 0.0)
    return result


def _future(model: XGBRegressor, series: list[float], weeks: list[str], horizon: int) -> list[dict[str, Any]]:
    history = list(series)
    last_week = date.fromisoformat(weeks[-1])
    result: list[dict[str, Any]] = []
    for step in range(1, horizon + 1):
        target = date.fromordinal(last_week.toordinal() + 7 * step)
        week_string = target.isoformat()
        index = len(history)
        amount = max(0.0, float(model.predict([_features(history, week_string, index)])[0]))
        result.append({"week": week_string, "amount": round(amount, 2)})
        history.append(amount)
    return result


def _fit_series(
    series: list[float],
    weeks: list[str],
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    count = len(series)
    if count < MIN_WEEKS:
        raise ValueError(f"At least {MIN_WEEKS} weeks of sales history are required")
    train_end = max(24, int(count * 0.70))
    validation_end = max(train_end + 4, int(count * 0.85))
    validation_end = min(validation_end, count - 2)
    _notify(on_progress, "split_data", "ok", {
        "train_weeks": train_end,
        "validation_weeks": validation_end - train_end,
        "test_weeks": count - validation_end,
    })

    train_x, train_y = _training_rows(series, weeks, train_end)
    if len(train_x) < 12:
        raise ValueError("Not enough weekly history to train the revenue model")

    tuning: list[dict[str, Any]] = []
    best_params = PARAMETER_GRID[0]
    best_score = float("inf")
    for parameters in PARAMETER_GRID:
        _notify(on_progress, "tune_model", "running", {
            "candidate": len(tuning) + 1,
            "candidate_count": len(PARAMETER_GRID),
            **parameters,
        })
        candidate = _model(parameters)
        candidate.fit(train_x, train_y, verbose=False)
        actual = series[train_end:validation_end]
        predicted = _predict_rolling(candidate, series, weeks, train_end, validation_end)
        score = _mae(actual, predicted)
        tuning.append({**parameters, "validation_mae": round(score, 2)})
        _notify(on_progress, "tune_model", "running", {
            "candidate": len(tuning),
            "candidate_count": len(PARAMETER_GRID),
            "validation_mae": round(score, 2),
        })
        if score < best_score:
            best_score, best_params = score, parameters

    _notify(on_progress, "tune_model", "ok", {
        "candidate_count": len(tuning),
        "best_validation_mae": round(best_score, 2),
    })

    final_x, final_y = _training_rows(series, weeks, validation_end)
    final_model = _model(best_params)
    _notify(on_progress, "fit_final_model", "running", {"training_rows": len(final_y)})
    final_model.fit(final_x, final_y, verbose=False)
    _notify(on_progress, "fit_final_model", "ok", {"training_rows": len(final_y)})
    _notify(on_progress, "evaluate_model", "running", {"test_weeks": count - validation_end})
    actual_test = series[validation_end:]
    predicted_test = _predict_rolling(final_model, series, weeks, validation_end, count)
    baselines = {
        "moving_average_4": _metrics(
            actual_test, _moving_average_predictions(series, validation_end, count, 4),
        ),
    }
    if validation_end >= 52:
        baselines["seasonal_naive_52"] = _metrics(
            actual_test,
            [series[index - 52] for index in range(validation_end, count)],
        )
    _notify(on_progress, "evaluate_model", "ok", {"test_weeks": count - validation_end})
    return {
        "model": final_model,
        "parameters": best_params,
        "tuning": tuning,
        "split": {"train_end": train_end, "validation_end": validation_end},
        "test_actual": actual_test,
        "test_predicted": predicted_test,
        "metrics": _metrics(actual_test, predicted_test),
        "baselines": baselines,
        "future": _future(final_model, series, weeks, FORECAST_HORIZON),
    }


def _branch_root(branch_id: str) -> Path:
    branch_key = hashlib.sha256(branch_id.encode("utf-8")).hexdigest()[:20]
    return Path(settings.ai_artifact_dir) / "revenue" / branch_key


def train_revenue_model(
    db: Database,
    branch_id: str,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Train store and top-SKU weekly net sales models, then activate atomically."""
    dataset = _collect(db, branch_id, on_progress)
    weeks = dataset["weeks"]
    total_result = _fit_series(dataset["total"], weeks, on_progress)

    train_end = total_result["split"]["train_end"]
    ranked_products = sorted(
        dataset["products"],
        key=lambda product_id: sum(max(0.0, value) for value in dataset["products"][product_id][:train_end]),
        reverse=True,
    )[:TOP_PRODUCTS]
    product_results: list[dict[str, Any]] = []
    product_models: dict[str, XGBRegressor] = {}
    _notify(on_progress, "train_product_models", "running", {"products_selected": len(ranked_products)})
    for index, product_id in enumerate(ranked_products, start=1):
        series = dataset["products"][product_id]
        try:
            result = _fit_series(series, weeks)
        except ValueError:
            _notify(on_progress, "train_product_models", "running", {
                "product": index,
                "product_count": len(ranked_products),
                "product_name": dataset["product_names"].get(product_id, product_id),
                "status": "skipped",
            })
            continue
        product_models[product_id] = result["model"]
        product_results.append({
            "product_id": product_id,
            "product_name": dataset["product_names"].get(product_id, product_id),
            "metrics": result["metrics"],
            "future": result["future"],
        })
        _notify(on_progress, "train_product_models", "running", {
            "product": index,
            "product_count": len(ranked_products),
            "product_name": dataset["product_names"].get(product_id, product_id),
            "status": "ok",
        })
    _notify(on_progress, "train_product_models", "ok", {"models_trained": len(product_models)})

    trained_at = datetime.now(timezone.utc).isoformat()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    root = _branch_root(branch_id)
    run_dir = root / "runs" / run_id
    _notify(on_progress, "save_artifacts", "running", {"run_id": run_id})
    run_dir.mkdir(parents=True, exist_ok=False)
    model_path = run_dir / "total_revenue.json"
    total_result["model"].save_model(str(model_path))

    sku_model_files: dict[str, str] = {}
    sku_dir = run_dir / "products"
    sku_dir.mkdir()
    for product_id, model in product_models.items():
        filename = f"{product_id}.json"
        model.save_model(str(sku_dir / filename))
        sku_model_files[product_id] = f"products/{filename}"

    test_start = total_result["split"]["validation_end"]
    metrics = {
        "algorithm": "xgboost_weekly_net_revenue",
        "unit": "MMK",
        "horizon_weeks": FORECAST_HORIZON,
        "features": list(FEATURES),
        "trained_at": trained_at,
        "history_weeks": len(weeks),
        "week_from": weeks[0],
        "week_to": weeks[-1],
        "total": {
            "metrics": total_result["metrics"],
            "baselines": total_result["baselines"],
            "parameters": total_result["parameters"],
            "validation_candidates": total_result["tuning"],
            "test_weeks": weeks[test_start:],
            "test_actual": [round(value, 2) for value in total_result["test_actual"]],
            "test_predicted": [round(value, 2) for value in total_result["test_predicted"]],
            "future": total_result["future"],
        },
        "products": product_results,
    }
    metrics_path = run_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    manifest = {
        "branch_id": branch_id,
        "run_id": run_id,
        "trained_at": trained_at,
        "model_file": "total_revenue.json",
        "product_model_files": sku_model_files,
        "metrics_file": "metrics.json",
    }
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    active_path = root / "active.json"
    active_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = active_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    _notify(on_progress, "save_artifacts", "ok", {"run_id": run_id, "product_models": len(product_models)})
    _notify(on_progress, "activate_model", "running", {"run_id": run_id})
    os.replace(tmp_path, active_path)
    _notify(on_progress, "activate_model", "ok", {"run_id": run_id})
    return {"run_id": run_id, "trained_at": trained_at, "metrics": metrics}


def get_revenue_forecast(db: Database, branch_id: str) -> dict[str, Any]:
    """Return active-model backtest and fresh four-week forecasts."""
    active_path = _branch_root(branch_id) / "active.json"
    if not active_path.exists():
        rows = db.fetch_all(SALES_HISTORY_COUNT_SQL, (branch_id,))
        history_weeks = int(rows[0].get("weeks") or 0) if rows else 0
        return {
            "trained": False,
            "forecast": None,
            "history_weeks": history_weeks,
            "weeks_required": MIN_WEEKS,
        }
    try:
        manifest = json.loads(active_path.read_text(encoding="utf-8"))
        run_dir = active_path.parent / "runs" / str(manifest["run_id"])
        metrics = json.loads((run_dir / manifest["metrics_file"]).read_text(encoding="utf-8"))
        model = XGBRegressor()
        model.load_model(str(run_dir / manifest["model_file"]))
        dataset = _collect(db, branch_id)
    except (OSError, ValueError, KeyError, TypeError, XGBoostError) as exc:
        raise ValueError("Revenue forecast model could not be loaded") from exc

    weeks = dataset["weeks"]
    total_series = dataset["total"]
    if len(total_series) < 12:
        return {"trained": True, "forecast": None, "metrics": metrics}
    future = _future(model, total_series, weeks, FORECAST_HORIZON)
    product_forecasts: list[dict[str, Any]] = []
    product_files = manifest.get("product_model_files", {})
    for product_id, relative_path in product_files.items():
        series = dataset["products"].get(product_id)
        if series is None or len(series) < 12:
            continue
        try:
            product_model = XGBRegressor()
            product_model.load_model(str(run_dir / relative_path))
        except (OSError, ValueError, XGBoostError):
            continue
        product_forecasts.append({
            "product_id": product_id,
            "product_name": dataset["product_names"].get(product_id, product_id),
            "next_week_amount": round(_future(product_model, series, weeks, 1)[0]["amount"], 2),
        })
    product_forecasts.sort(key=lambda row: row["next_week_amount"], reverse=True)
    return {
        "trained": True,
        "run_id": manifest["run_id"],
        "trained_at": manifest["trained_at"],
        "metrics": metrics,
        "history_weeks": len(weeks),
        "weeks_required": MIN_WEEKS,
        "actual_weeks": weeks[-52:],
        "actual_revenue": [round(value, 2) for value in total_series[-52:]],
        "forecast": future,
        "top_products": product_forecasts,
        "last_actual_week": weeks[-1],
    }


