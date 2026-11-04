"""Rule-based operations alerts. No LLM, no quotas — pure SQL + thresholds:

- Dead stock: capital sitting in unsold batches (expiry/write-off prevention).
- Supplier price watch: GRN cost drift per product (purchasing savings).
- Abuse watch: void/discount outliers per cashier (shrinkage control).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

DEAD_STOCK_QUERY = """
SELECT p.id AS product_id, p.name AS product_name,
       COALESCE(SUM(i.current_stock_quantity), 0) AS on_hand,
       COALESCE(SUM(i.current_stock_quantity * i.purchase_price), 0) AS stock_value,
       s.last_sale AS last_sale
FROM products p
JOIN items i ON i.product_id = p.id AND i.branch_id = %s
LEFT JOIN (
  SELECT sd.product_id AS pid, MAX(s.sale_date) AS last_sale
  FROM sale_detail sd
  JOIN sale s ON s.id = sd.sale_id
  WHERE s.branch_id = %s AND s.status = 'completed'
  GROUP BY sd.product_id
) s ON s.pid = p.id
WHERE p.branch_id = %s AND p.is_deleted = false
GROUP BY p.id, p.name, s.last_sale
"""

PRICE_WATCH_QUERY = """
SELECT i.product_id AS product_id, p.name AS product_name,
       MIN(i.purchase_price) AS min_cost, MAX(i.purchase_price) AS max_cost
FROM items i
JOIN products p ON p.id = i.product_id
JOIN grn g ON g.id = i.grn_id
WHERE i.branch_id = %s
  AND g.received_date >= NOW() - (%s || ' days')::INTERVAL
GROUP BY i.product_id, p.name
HAVING COUNT(DISTINCT i.purchase_price) > 1
"""

ABUSE_QUERY = """
SELECT COALESCE(u.user_name, 'unknown') AS cashier,
       COUNT(*) FILTER (WHERE s.status = 'voided') AS voids,
       COUNT(*) FILTER (WHERE s.status IN ('completed', 'voided')) AS total,
       COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status = 'completed'), 0) AS discounts
FROM sale s
LEFT JOIN users u ON u.id = s.created_by
WHERE s.branch_id = %s AND s.status IN ('completed', 'voided')
  AND s.sale_date >= NOW() - (%s || ' days')::INTERVAL
GROUP BY u.user_name
"""


def _days_since(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return max((datetime.now(timezone.utc) - value).total_seconds() / 86_400, 0.0)


class DeadStockAnalyzer:
    def analyze(self, rows: list[dict[str, Any]], *, dead_days: int) -> list[dict[str, Any]]:
        out = []
        for r in rows:
            on_hand = float(r.get("on_hand") or 0)
            if on_hand <= 0:
                continue
            age = _days_since(r.get("last_sale"))
            if age is None or age >= dead_days:
                out.append({
                    "product_id": str(r["product_id"]),
                    "product_name": str(r.get("product_name") or ""),
                    "on_hand": on_hand,
                    "stock_value": float(r.get("stock_value") or 0),
                    "days_since_sale": None if age is None else round(age, 1),
                })
        return sorted(out, key=lambda f: -f["stock_value"])


class SupplierPriceWatcher:
    def analyze(self, rows: list[dict[str, Any]], *, min_change_pct: float) -> list[dict[str, Any]]:
        out = []
        for r in rows:
            lo, hi = float(r.get("min_cost") or 0), float(r.get("max_cost") or 0)
            if lo <= 0:
                continue
            change = round((hi - lo) / lo * 100, 1)
            if change >= min_change_pct:
                out.append({
                    "product_id": str(r["product_id"]),
                    "product_name": str(r.get("product_name") or ""),
                    "min_cost": lo,
                    "max_cost": hi,
                    "change_pct": change,
                })
        return sorted(out, key=lambda f: -f["change_pct"])


class AbuseWatcher:
    def analyze(
        self, rows: list[dict[str, Any]], *, min_sales: int,
        void_rate_pct: float, discount_warn: float,
    ) -> list[dict[str, Any]]:
        out = []
        for r in rows:
            total, voids = int(r.get("total") or 0), int(r.get("voids") or 0)
            discounts = float(r.get("discounts") or 0)
            if total < min_sales:
                continue
            flags = []
            void_rate = round(voids / total * 100, 1)
            if void_rate >= void_rate_pct:
                flags.append("high_void_rate")
            if discounts >= discount_warn:
                flags.append("high_discounts")
            if flags:
                out.append({
                    "cashier": str(r.get("cashier") or "unknown"),
                    "voids": voids,
                    "total_sales": total,
                    "void_rate_pct": void_rate,
                    "discounts": discounts,
                    "flags": flags,
                })
        return sorted(out, key=lambda f: (-f["void_rate_pct"], -f["discounts"]))
