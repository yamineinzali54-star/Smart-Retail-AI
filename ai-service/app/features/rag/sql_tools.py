"""Pre-written read-only SQL templates ("tools") — the cheap first tier of
the RAG pipeline.

A template is rendered server-side with strictly validated arguments and is
then re-checked by SQLGuard exactly like model-generated SQL, so a tool can
never widen branch scope or leave the read-only surface. The branch id is
injected only from the authenticated job context (never from model output)
and must look like an id before it is interpolated. Date boundaries are
computed in Asia/Yangon — the same zone the read-only sessions use — as
plain 'YYYY-MM-DD' literals, so relative questions stay correct and never
depend on SQL date functions that the guard allowlist may not expose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

MAX_DAYS = 365
MAX_LIMIT = 100
BUSINESS_TZ = ZoneInfo("Asia/Yangon")

_BRANCH_ID_RE = re.compile(r"[0-9A-Za-z_-]{3,64}")
_INT_RE = re.compile(r"-?\d+")


@dataclass(frozen=True)
class SQLTool:
    name: str
    description: str
    template: str
    tables: tuple[str, ...]
    # A tool accepts `days` iff default_days is set (likewise limit/status).
    default_days: int | None = None
    default_limit: int | None = None
    allowed_status: tuple[str, ...] = ()
    default_status: str = ""


SQL_TOOLS: tuple[SQLTool, ...] = (
    SQLTool(
        name="today_sales",
        description="Completed sales count and revenue for today",
        template=(
            "SELECT COUNT(s.id) AS sale_count, SUM(s.grand_total) AS revenue "
            "FROM sale s WHERE s.branch_id = '{branch_id}' AND s.status = 'completed' "
            "AND s.sale_date >= '{today}'"
        ),
        tables=("sale",),
    ),
    SQLTool(
        name="sales_by_day",
        description="Completed sales count and revenue grouped by day for a recent period",
        template=(
            "SELECT CAST(s.sale_date AS date) AS sale_day, COUNT(s.id) AS sale_count, "
            "SUM(s.grand_total) AS revenue FROM sale s "
            "WHERE s.branch_id = '{branch_id}' AND s.status = 'completed' "
            "AND s.sale_date >= '{start_date}' "
            "GROUP BY CAST(s.sale_date AS date) ORDER BY sale_day DESC LIMIT {limit}"
        ),
        tables=("sale",),
        default_days=7,
        default_limit=31,
    ),
    SQLTool(
        name="top_products",
        description="Best-selling products by quantity and revenue for a recent period",
        template=(
            "SELECT p.name AS product_name, SUM(d.quantity) AS quantity_sold, "
            "SUM(d.line_total) AS revenue FROM sale_detail d "
            "JOIN sale s ON d.sale_id = s.id JOIN products p ON d.product_id = p.id "
            "WHERE s.branch_id = '{branch_id}' AND p.branch_id = '{branch_id}' "
            "AND s.status = 'completed' AND s.sale_date >= '{start_date}' "
            "GROUP BY p.id, p.name ORDER BY revenue DESC LIMIT {limit}"
        ),
        tables=("sale_detail", "sale", "products"),
        default_days=7,
        default_limit=10,
    ),
    SQLTool(
        name="category_sales",
        description="Revenue and quantity sold by category for a recent period",
        template=(
            "SELECT c.name AS category_name, SUM(d.line_total) AS revenue, "
            "SUM(d.quantity) AS quantity_sold FROM sale_detail d "
            "JOIN sale s ON d.sale_id = s.id JOIN products p ON d.product_id = p.id "
            "JOIN category c ON p.category_id = c.id "
            "WHERE s.branch_id = '{branch_id}' AND p.branch_id = '{branch_id}' "
            "AND c.branch_id = '{branch_id}' AND s.status = 'completed' "
            "AND s.sale_date >= '{start_date}' "
            "GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT {limit}"
        ),
        tables=("sale_detail", "sale", "products", "category"),
        default_days=7,
        default_limit=10,
    ),
    SQLTool(
        name="low_stock",
        description="Products whose total stock is at or below their reorder threshold",
        template=(
            "SELECT p.name AS product_name, SUM(i.current_stock_quantity) AS stock_quantity, "
            "p.reorder_threshold AS reorder_threshold FROM items i "
            "JOIN products p ON i.product_id = p.id "
            "WHERE i.branch_id = '{branch_id}' AND p.branch_id = '{branch_id}' "
            "AND p.is_deleted = false "
            "GROUP BY p.id, p.name, p.reorder_threshold "
            "HAVING SUM(i.current_stock_quantity) <= p.reorder_threshold "
            "ORDER BY stock_quantity ASC LIMIT {limit}"
        ),
        tables=("items", "products"),
        default_limit=20,
    ),
    SQLTool(
        name="expiring_batches",
        description="Stocked batches expiring within a number of days",
        template=(
            "SELECT p.name AS product_name, i.barcode AS barcode, "
            "i.expiry_date AS expiry_date, i.current_stock_quantity AS stock_quantity "
            "FROM items i JOIN products p ON i.product_id = p.id "
            "WHERE i.branch_id = '{branch_id}' AND p.branch_id = '{branch_id}' "
            "AND i.current_stock_quantity > 0 AND i.expiry_date IS NOT NULL "
            "AND i.expiry_date <= '{expiry_cutoff}' "
            "ORDER BY i.expiry_date ASC LIMIT {limit}"
        ),
        tables=("items", "products"),
        default_days=30,
        default_limit=20,
    ),
    SQLTool(
        name="po_status",
        description="Purchase orders for one status",
        template=(
            "SELECT po.po_number AS po_number, sup.name AS supplier_name, "
            "po.status AS status, po.order_date AS order_date, "
            "po.total_amount AS total_amount FROM purchase_order po "
            "JOIN suppliers sup ON po.supplier_id = sup.id "
            "WHERE po.branch_id = '{branch_id}' AND sup.branch_id = '{branch_id}' "
            "AND po.status = '{status}' ORDER BY po.order_date DESC LIMIT {limit}"
        ),
        tables=("purchase_order", "suppliers"),
        allowed_status=("pending", "partially_received", "received"),
        default_status="pending",
        default_limit=20,
    ),
    SQLTool(
        name="supplier_spend",
        description="Purchase order spend and count by supplier for a recent period",
        template=(
            "SELECT sup.name AS supplier_name, SUM(po.total_amount) AS total_spend, "
            "COUNT(po.id) AS order_count FROM purchase_order po "
            "JOIN suppliers sup ON po.supplier_id = sup.id "
            "WHERE po.branch_id = '{branch_id}' AND sup.branch_id = '{branch_id}' "
            "AND po.order_date >= '{start_date}' "
            "GROUP BY sup.id, sup.name ORDER BY total_spend DESC LIMIT {limit}"
        ),
        tables=("purchase_order", "suppliers"),
        default_days=30,
        default_limit=10,
    ),
    SQLTool(
        name="session_summary",
        description="POS sessions with cash reconciliation figures for a recent period",
        template=(
            "SELECT ps.start_time AS start_time, ps.status AS status, "
            "ps.opening_cash AS opening_cash, "
            "ps.expected_closing_cash AS expected_closing_cash, "
            "ps.actual_closing_cash AS actual_closing_cash, "
            "ps.cash_difference AS cash_difference FROM pos_session ps "
            "WHERE ps.branch_id = '{branch_id}' AND ps.start_time >= '{start_date}' "
            "ORDER BY ps.start_time DESC LIMIT {limit}"
        ),
        tables=("pos_session",),
        default_days=7,
        default_limit=20,
    ),
    SQLTool(
        name="profit_margin",
        description="Revenue, estimated batch cost, profit and margin percent for a recent period",
        template=(
            "SELECT SUM(d.line_total) AS revenue, "
            "SUM(d.quantity * i.purchase_price) AS cost, "
            "SUM(d.line_total) - SUM(d.quantity * i.purchase_price) AS profit, "
            "round(100.0 * (SUM(d.line_total) - SUM(d.quantity * i.purchase_price)) "
            "/ NULLIF(SUM(d.line_total), 0), 1) AS margin_percent "
            "FROM sale_detail d JOIN sale s ON d.sale_id = s.id "
            "JOIN items i ON d.item_id = i.id "
            "WHERE s.branch_id = '{branch_id}' AND i.branch_id = '{branch_id}' "
            "AND s.status = 'completed' AND s.sale_date >= '{start_date}'"
        ),
        tables=("sale_detail", "sale", "items"),
        default_days=7,
    ),
)

_INDEX: dict[str, SQLTool] = {tool.name: tool for tool in SQL_TOOLS}


def tool_by_name(name: str) -> SQLTool | None:
    return _INDEX.get(name) if isinstance(name, str) else None


def _bounded_int(raw: object, lo: int, hi: int, default: int) -> int:
    if isinstance(raw, bool):
        return default
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str) and _INT_RE.fullmatch(raw.strip()):
        value = int(raw.strip())
    else:
        return default
    return max(lo, min(hi, value))


def render_tool(name: object, args: object, branch_id: str) -> str | None:
    """Render a registered template, or None when the tool/args/branch are
    unusable — the caller then falls back to full SQL generation."""
    tool = tool_by_name(name) if isinstance(name, str) else None
    if tool is None:
        return None
    if not isinstance(branch_id, str) or not _BRANCH_ID_RE.fullmatch(branch_id):
        return None
    if not isinstance(args, dict):
        args = {}
    today = datetime.now(BUSINESS_TZ).date()
    values: dict[str, str | int] = {
        "branch_id": branch_id,
        "today": today.isoformat(),
    }
    if tool.default_days is not None:
        days = _bounded_int(args.get("days"), 1, MAX_DAYS, tool.default_days)
        values["days"] = days
        values["start_date"] = (today - timedelta(days=days - 1)).isoformat()
        values["expiry_cutoff"] = (today + timedelta(days=days)).isoformat()
    if tool.default_limit is not None:
        values["limit"] = _bounded_int(args.get("limit"), 1, MAX_LIMIT, tool.default_limit)
    if tool.allowed_status:
        status = args.get("status", tool.default_status)
        if not isinstance(status, str) or status not in tool.allowed_status:
            return None
        values["status"] = status
    try:
        return tool.template.format(**values)
    except (KeyError, IndexError, ValueError):
        return None


def tool_catalog_prompt() -> str:
    """The tool section appended to the intent-classification system prompt."""
    lines = [
        "Registered read-only query tools. Set tool only when one exactly "
        "answers the request; otherwise tool must be null.",
    ]
    for tool in SQL_TOOLS:
        args: list[str] = []
        if tool.default_days is not None:
            args.append(f"days (1-{MAX_DAYS}, default {tool.default_days})")
        if tool.default_limit is not None:
            args.append(f"limit (1-{MAX_LIMIT}, default {tool.default_limit})")
        if tool.allowed_status:
            args.append(
                f"status ({' or '.join(tool.allowed_status)}, default {tool.default_status})"
            )
        suffix = f" Args: {', '.join(args)}." if args else ""
        lines.append(f"- {tool.name}: {tool.description}.{suffix}")
    return "\n".join(lines)
