"""File-based data collection and preparation for the forecasting KDD pipeline.

The pipeline is file-first. The database is read exactly ONCE (STEP 1) to
produce a raw CSV artifact; every later step works on that file:

  ① collect_raw_csv()   sale ⋈ sale_detail ⋈ products  ->  dataset_raw.csv
  ② prepare_from_csv()  raw CSV -> clean -> product x day -> zero-fill
                                          ->  dataset_prepared.csv
  ③ load_matrix()       prepared CSV -> {product_ids, days, matrix}

STEP 2 turns the transaction grain into the daily grain the forecaster
consumes. A calendar day with no sale is a genuine ZERO (demand was zero),
not a missing observation, so the calendar is re-indexed and filled with 0
— never mean-imputed, which would erase the intermittent-demand signal.
"""

from __future__ import annotations

import csv
import hashlib
import os
from collections.abc import Iterable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

RAW_EXPORT_SQL = """
SELECT
  b.code                AS branch_code,
  s.id                  AS sale_id,
  s.sale_number         AS sale_number,
  s.sale_date           AS sale_date,
  s.status              AS sale_status,
  s.payment_method      AS payment_method,
  s.pos_session_id      AS pos_session_id,
  s.created_by          AS cashier_id,
  sd.id                 AS sale_detail_id,
  sd.product_id         AS product_id,
  p.name                AS product_name,
  c.name                AS category_name,
  sd.quantity           AS quantity,
  sd.unit_price         AS unit_price,
  sd.discount           AS discount,
  sd.tax_rate_applied   AS tax_rate_applied,
  sd.line_total         AS line_total,
  COALESCE(r.qty, 0)    AS returned_qty,
  COALESCE(r.amt, 0)    AS returned_amount
FROM sale_detail sd
JOIN sale s     ON s.id = sd.sale_id
JOIN branch b   ON b.id = s.branch_id
JOIN products p ON p.id = sd.product_id
JOIN category c ON c.id = p.category_id
LEFT JOIN (
  SELECT sale_detail_id, SUM(quantity) AS qty, SUM(refund_amount) AS amt
  FROM sale_return_detail
  GROUP BY sale_detail_id
) r ON r.sale_detail_id = sd.id
WHERE s.branch_id = %s
ORDER BY s.sale_date, s.sale_number, sd.product_id, sd.id
"""

RAW_CSV_COLUMNS = [
    "branch_code", "sale_id", "sale_number", "sale_date", "sale_status",
    "payment_method", "pos_session_id", "cashier_id", "sale_detail_id",
    "product_id", "product_name", "category_name", "quantity", "unit_price",
    "discount", "tax_rate_applied", "line_total", "returned_qty",
    "returned_amount",
]

PREPARED_CSV_COLUMNS = [
    "branch_code", "product_id", "product_name", "day", "weekday", "qty",
]

# Only completed sales carry demand. Voided sales are kept in the RAW file
# (that is what makes the cleaning step visible) and dropped here.
COMPLETED_STATUS = "completed"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_raw_csv(db: Any, branch_id: str, out_path: Path) -> dict[str, Any]:
    """STEP 1 — export the sale ⋈ sale_detail join to a CSV artifact.

    Returns a manifest dict: path, rows, bytes, sha256.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    with tmp_path.open("w", newline="", encoding="utf-8") as fh:
        db.copy_to_csv(RAW_EXPORT_SQL, (branch_id,), fh)
    os.replace(tmp_path, out_path)
    with out_path.open("r", encoding="utf-8", newline="") as fh:
        rows = max(sum(1 for _ in fh) - 1, 0)
    return {
        "path": str(out_path),
        "rows": rows,
        "bytes": out_path.stat().st_size,
        "sha256": sha256_file(out_path),
        "columns": list(RAW_CSV_COLUMNS),
    }


def _clean_rows(raw_rows: Iterable[dict[str, str]]) -> tuple[list[tuple], dict[str, int]]:
    """Drop unusable rows and net out returns.

    Returns (cleaned rows, counters). Each cleaned row is
    (branch_code, product_id, product_name, day, net_quantity).
    """
    counters = {
        "dropped_incomplete": 0, "dropped_status": 0, "dropped_nonpositive": 0,
        "dropped_duplicate": 0, "returned_lines": 0, "returned_units": 0,
    }
    seen: set[tuple[str, str]] = set()
    cleaned: list[tuple] = []
    for row in raw_rows:
        product_id = (row.get("product_id") or "").strip()
        quantity_raw = (row.get("quantity") or "").strip()
        if not product_id or not quantity_raw:
            counters["dropped_incomplete"] += 1
            continue
        if (row.get("sale_status") or "").strip() != COMPLETED_STATUS:
            counters["dropped_status"] += 1
            continue
        try:
            quantity = int(quantity_raw)
        except ValueError:
            counters["dropped_incomplete"] += 1
            continue
        if quantity <= 0:
            counters["dropped_nonpositive"] += 1
            continue
        sale_number = (row.get("sale_number") or "").strip()
        key = (sale_number, product_id)
        if key in seen:
            counters["dropped_duplicate"] += 1
            continue
        seen.add(key)
        # Returns reduce the demand actually served on that day.
        returned_qty = 0
        returned_raw = (row.get("returned_qty") or "").strip()
        if returned_raw:
            try:
                returned_qty = int(returned_raw)
            except ValueError:
                returned_qty = 0
        net = quantity - returned_qty
        if returned_qty:
            counters["returned_lines"] += 1
            counters["returned_units"] += returned_qty
        if net < 0:
            net = 0
        day = (row.get("sale_date") or "")[:10]
        cleaned.append((
            (row.get("branch_code") or "").strip(), product_id,
            (row.get("product_name") or product_id).strip(), day, net,
        ))
    return cleaned, counters


def prepare_from_csv(raw_path: Path, out_path: Path) -> dict[str, Any]:
    """STEP 2 — clean, aggregate to product x day and zero-fill the calendar.

    The prepared CSV is the model input: every (product, calendar day) pair
    is present exactly once, with qty 0 on days without a sale.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("r", encoding="utf-8", newline="") as fh:
        raw_rows = list(csv.DictReader(fh))
    cleaned, counters = _clean_rows(raw_rows)

    daily: dict[tuple[str, str], int] = {}
    products: dict[str, str] = {}
    branch_code = ""
    for bc, product_id, product_name, day, net in cleaned:
        if not day:
            counters["dropped_incomplete"] += 1
            continue
        branch_code = branch_code or bc
        key = (product_id, day)
        daily[key] = daily.get(key, 0) + net
        products[product_id] = product_name

    if not daily:
        raise ValueError("no usable rows in raw dataset")

    days = sorted({day for _, day in daily})
    first = date.fromisoformat(days[0])
    last = date.fromisoformat(days[-1])
    span = (last - first).days + 1
    product_ids = sorted(products)

    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    zero_filled = 0
    with tmp_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(PREPARED_CSV_COLUMNS)
        day = first
        while day <= last:
            iso = day.isoformat()
            weekday = day.strftime("%a")
            for product_id in product_ids:
                qty = daily.get((product_id, iso), 0)
                if qty == 0:
                    zero_filled += 1
                writer.writerow([
                    branch_code, product_id, products[product_id], iso, weekday, qty,
                ])
            day += timedelta(days=1)
    os.replace(tmp_path, out_path)

    return {
        "path": str(out_path),
        "rows": len(product_ids) * span,
        "bytes": out_path.stat().st_size,
        "sha256": sha256_file(out_path),
        "columns": list(PREPARED_CSV_COLUMNS),
        "products": len(product_ids),
        "calendar_days": span,
        "day_from": first.isoformat(),
        "day_to": last.isoformat(),
        "non_zero_cells": len(daily),
        "zero_filled_cells": zero_filled,
        "cleaning": counters,
    }


def load_matrix(prepared_path: Path) -> dict[str, Any]:
    """STEP 3 helper — read the prepared CSV into a dense product x day matrix.

    The trainer and the serving job (forecast_build) both call this, so the
    feature pipeline is identical on both sides.
    """
    with prepared_path.open("r", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise ValueError("prepared dataset is empty")
    branch_code = rows[0]["branch_code"]
    series: dict[str, list[tuple[str, int]]] = {}
    names: dict[str, str] = {}
    for row in rows:
        product_id = row["product_id"]
        names[product_id] = row.get("product_name") or product_id
        series.setdefault(product_id, []).append((row["day"], int(row["qty"])))
    product_ids = sorted(series)
    days = sorted({day for values in series.values() for day, _ in values})
    index = {day: i for i, day in enumerate(days)}
    matrix = [[0.0] * len(days) for _ in product_ids]
    for row_index, product_id in enumerate(product_ids):
        for day, qty in series[product_id]:
            position = index[day]
            if 0 <= position < len(days):
                matrix[row_index][position] = float(qty)
    return {
        "branch_code": branch_code,
        "product_ids": product_ids,
        "product_names": names,
        "days": days,
        "matrix": matrix,
    }
