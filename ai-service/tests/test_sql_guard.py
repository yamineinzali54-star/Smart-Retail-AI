import pytest

from app.core.base_job import JobContext
from app.core.llm.base import StubLLMProvider
from app.features.rag.text_to_sql import SQLGuard, TextToSQLJob

LIVE_SCHEMA = {
    "products": {"columns": ["id", "branch_id", "name"], "types": {}, "branch_columns": ["branch_id"], "foreign_keys": []},
    "sale": {"columns": ["id", "branch_id", "sale_number"], "types": {}, "branch_columns": ["branch_id"], "foreign_keys": []},
    "sale_detail": {
        "columns": ["id", "sale_id"], "types": {}, "branch_columns": [],
        "foreign_keys": [("sale_id", "sale", "id")],
    },
}


def test_valid_select_passes_and_keeps_limit():
    sql = SQLGuard.validate("SELECT p.id, p.name FROM products p WHERE p.branch_id = 'YGN' LIMIT 20")
    assert "LIMIT 20" in sql


def test_missing_limit_gets_default():
    sql = SQLGuard.validate("SELECT p.id FROM products p WHERE p.branch_id = 'YGN'")
    assert "LIMIT 100" in sql


def test_missing_branch_filter_rejected():
    with pytest.raises(ValueError):
        SQLGuard.validate("SELECT id, name FROM products LIMIT 10")


def test_live_schema_select_requires_top_level_branch_where_predicate():
    sql = SQLGuard.validate(
        "SELECT s.sale_number FROM sale s WHERE s.branch_id = 'branch-a'",
        "branch-a",
        LIVE_SCHEMA,
    )
    assert "WHERE s.branch_id = 'branch-a'" in sql


@pytest.mark.parametrize("sql", [
    # A branch equality in a projection does not filter returned rows.
    "SELECT s.sale_number, CASE WHEN s.branch_id = 'branch-a' THEN 1 ELSE 1 END AS marker FROM sale s",
    # A branch equality in JOIN ON does not constrain a top-level base table.
    "SELECT s.sale_number FROM sale s LEFT JOIN products p ON p.branch_id = 'branch-a' WHERE s.id = p.id",
    # Implicit/comma joins must be parsed and scoped too.
    "SELECT COUNT(*) FROM products p, sale s WHERE p.branch_id = 'branch-a'",
])
def test_branch_scope_cannot_be_satisfied_outside_top_level_where(sql):
    with pytest.raises(ValueError):
        SQLGuard.validate(sql, "branch-a", LIVE_SCHEMA)


def test_detail_rows_must_join_to_branch_scoped_parent_through_fk():
    sql = SQLGuard.validate(
        "SELECT d.id FROM sale_detail d JOIN sale s ON d.sale_id = s.id "
        "WHERE s.branch_id = 'branch-a'",
        "branch-a",
        LIVE_SCHEMA,
    )
    assert "sale_detail" in sql


def test_fk_equality_hidden_in_case_does_not_scope_detail_rows():
    sql = (
        "SELECT d.id FROM sale_detail d, sale s "
        "WHERE s.branch_id = 'branch-a' AND "
        "CASE WHEN d.sale_id = s.id THEN TRUE ELSE TRUE END"
    )
    with pytest.raises(ValueError):
        SQLGuard.validate(sql, "branch-a", LIVE_SCHEMA)


def test_wrong_branch_and_or_are_rejected():
    with pytest.raises(ValueError):
        SQLGuard.validate("SELECT s.id FROM sale s WHERE s.branch_id = 'branch-b'", "branch-a", LIVE_SCHEMA)
    with pytest.raises(ValueError):
        SQLGuard.validate(
            "SELECT s.id FROM sale s WHERE s.branch_id = 'branch-a' OR s.id = 'x'",
            "branch-a",
            LIVE_SCHEMA,
        )


def test_limit_is_added_and_capped_using_ast():
    no_limit = SQLGuard.validate("SELECT p.id FROM products p WHERE p.branch_id = 'branch-a'", "branch-a", LIVE_SCHEMA)
    too_many = SQLGuard.validate(
        "SELECT p.id FROM products p WHERE p.branch_id = 'branch-a' LIMIT 500",
        "branch-a",
        LIVE_SCHEMA,
    )
    assert no_limit.endswith("LIMIT 100")
    assert too_many.endswith("LIMIT 100")


@pytest.mark.parametrize("bad", [
    "DELETE FROM products",
    "UPDATE products SET name='x'",
    "DROP TABLE sales",
    "SELECT * FROM sales; DROP TABLE sales",
    "INSERT INTO products(name) VALUES ('x')",
])
def test_write_and_multi_statement_rejected(bad):
    with pytest.raises(ValueError):
        SQLGuard.validate(bad)


def test_select_into_is_rejected():
    with pytest.raises(ValueError):
        SQLGuard.validate("SELECT p.id INTO copied FROM products p WHERE p.branch_id = 'x'")


def test_job_returns_guarded_sql():
    class SchemaDB:
        def get_schema(self):
            return LIVE_SCHEMA

    job = TextToSQLJob(
        StubLLMProvider(script=[
            '{"intent":"read","reply":""}',
            "SELECT s.sale_number FROM sale s WHERE s.branch_id = 'YGN'",
        ]),
        SchemaDB(),
    )
    result = job.execute(JobContext(branch_id="YGN", params={"question": "today sales?"}))
    assert result.ok and "SELECT" in result.data["sql"]


def test_job_fails_closed_on_empty_question():
    job = TextToSQLJob(StubLLMProvider("SELECT 1"))
    result = job.execute(JobContext(branch_id="YGN", params={"question": "  "}))
    assert not result.ok


def test_relative_date_functions_are_allowed():
    sql = SQLGuard.validate(
        "SELECT s.id AS id FROM sale s WHERE s.branch_id = 'branch-a' "
        "AND s.sale_date >= now() AND s.sale_date >= CURRENT_DATE"
    )
    assert "sale_date" in sql


def test_to_char_is_allowed_for_day_grouping():
    sql = SQLGuard.validate(
        "SELECT to_char(s.sale_date, 'YYYY-MM-DD') AS sale_day FROM sale s "
        "WHERE s.branch_id = 'branch-a'"
    )
    assert "sale_day" in sql
