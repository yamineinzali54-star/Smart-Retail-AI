import pytest

from app.features.rag.prompts import INTENT_SYSTEM_PROMPT
from app.features.rag.sql_tools import (
    MAX_DAYS,
    SQL_TOOLS,
    render_tool,
    tool_by_name,
    tool_catalog_prompt,
)
from app.features.rag.text_to_sql import SQLGuard

BRANCH = "11111111-2222-3333-4444-555555555555"

TOOLS_SCHEMA = {
    "branch": {"columns": ["id"], "types": {}, "branch_columns": [], "foreign_keys": []},
    "sale": {
        "columns": ["id", "branch_id", "sale_number", "pos_session_id", "grand_total", "status", "sale_date"],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id"), ("pos_session_id", "pos_session", "id")],
    },
    "sale_detail": {
        "columns": ["id", "sale_id", "item_id", "product_id", "quantity", "unit_price", "line_total"],
        "types": {},
        "branch_columns": [],
        "foreign_keys": [
            ("sale_id", "sale", "id"),
            ("item_id", "items", "id"),
            ("product_id", "products", "id"),
        ],
    },
    "products": {
        "columns": ["id", "branch_id", "category_id", "name", "reorder_threshold", "is_deleted"],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id"), ("category_id", "category", "id")],
    },
    "category": {
        "columns": ["id", "branch_id", "name"],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id")],
    },
    "items": {
        "columns": [
            "id", "branch_id", "product_id", "barcode",
            "current_stock_quantity", "expiry_date", "purchase_price",
        ],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id"), ("product_id", "products", "id")],
    },
    "suppliers": {
        "columns": ["id", "branch_id", "name"],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id")],
    },
    "purchase_order": {
        "columns": ["id", "branch_id", "supplier_id", "po_number", "status", "order_date", "total_amount"],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id"), ("supplier_id", "suppliers", "id")],
    },
    "pos_session": {
        "columns": [
            "id", "branch_id", "start_time", "status", "opening_cash",
            "expected_closing_cash", "actual_closing_cash", "cash_difference",
        ],
        "types": {},
        "branch_columns": ["branch_id"],
        "foreign_keys": [("branch_id", "branch", "id")],
    },
}


def test_catalog_lists_every_tool():
    prompt = tool_catalog_prompt()
    for tool in SQL_TOOLS:
        assert f"- {tool.name}:" in prompt


def test_intent_prompt_includes_tool_contract():
    assert '"tool":"name"|null' in INTENT_SYSTEM_PROMPT
    for tool in SQL_TOOLS:
        assert tool.name in INTENT_SYSTEM_PROMPT


@pytest.mark.parametrize("tool", SQL_TOOLS, ids=lambda tool: tool.name)
def test_every_template_renders_and_passes_sql_guard(tool):
    sql = render_tool(tool.name, {}, BRANCH)
    assert sql is not None
    guarded = SQLGuard.validate(sql, BRANCH, TOOLS_SCHEMA)
    assert "SELECT" in guarded
    assert BRANCH in guarded


@pytest.mark.parametrize("tool", SQL_TOOLS, ids=lambda tool: tool.name)
def test_every_template_is_single_statement_without_wildcard(tool):
    sql = render_tool(tool.name, {"days": 3, "limit": 5, "status": "received"}, BRANCH)
    assert sql is not None
    assert ";" not in sql
    assert "SELECT *" not in sql


def test_args_are_rendered_and_clamped():
    sql = render_tool("sales_by_day", {"days": 9999, "limit": 5}, BRANCH)
    assert sql is not None and "LIMIT 5" in sql
    clamped = render_tool("sales_by_day", {"days": 9999}, BRANCH)
    assert clamped is not None
    assert "LIMIT 31" in clamped
    assert render_tool("sales_by_day", {"days": -3}, BRANCH) is not None


def test_non_integer_args_never_reach_the_template():
    sql = render_tool("top_products", {"days": "7; DROP TABLE sale", "limit": [1]}, BRANCH)
    assert sql is not None
    assert "DROP" not in sql and ";" not in sql


def test_status_is_whitelisted():
    assert render_tool("po_status", {"status": "received"}, BRANCH) is not None
    assert render_tool("po_status", {}, BRANCH) is not None
    assert render_tool("po_status", {"status": "DROP TABLE sale"}, BRANCH) is None
    assert render_tool("po_status", {"status": 5}, BRANCH) is None


def test_unknown_tool_or_unsafe_branch_renders_nothing():
    assert render_tool("does_not_exist", {}, BRANCH) is None
    assert render_tool("", {}, BRANCH) is None
    assert render_tool(None, {}, BRANCH) is None
    assert render_tool("top_products", {}, "bad'branch") is None
    assert render_tool("top_products", {}, "") is None
    assert render_tool("top_products", {}, "branch; drop") is None


def test_tool_by_name_lookup():
    assert tool_by_name("low_stock") is not None
    assert tool_by_name("nope") is None
    assert tool_by_name(123) is None  # type: ignore[arg-type]


def test_date_bounds_are_iso_literals_within_range():
    sql = render_tool("sales_by_day", {"days": MAX_DAYS}, BRANCH)
    assert sql is not None
    assert "INTERVAL" not in sql
    assert "now()" not in sql
