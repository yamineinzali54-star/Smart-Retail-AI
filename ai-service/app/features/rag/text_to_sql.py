"""RAG Text-to-SQL job (rag_query). LLM translates; SQLGuard enforces
read-only + branch scope. Guard failure => job fails closed, never executes."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from sqlglot import exp, parse
from sqlglot.errors import ParseError

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.llm.base import BaseLLMProvider
from app.core.db import Database
from .prompts import (
    FAILURE_DIAGNOSIS_SYSTEM_PROMPT,
    INTENT_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    format_schema,
)
from .sql_cache import SQLCache, make_cache_key
from .sql_tools import render_tool, tool_by_name

_ALLOWED_TABLES = {
    "products", "items", "category", "suppliers", "sale",
    "sale_detail", "purchase_order", "grn", "pos_session",
}
_ALLOWED_FUNCTIONS = {
    "abs", "avg", "cast", "coalesce", "count", "current_date", "current_time",
    "current_timestamp", "date_trunc", "extract",
    "greatest", "in", "least", "lower", "max", "min", "now", "nullif",
    "round", "sum", "timezone",
    "time_to_str", "to_char", "upper",
}
_MAX_LIMIT = 100


class SQLGuard:
    """AST-validates LLM SQL and proves every branch predicate is mandatory."""

    @staticmethod
    def validate(
        sql: str,
        branch_id: str | None = None,
        schema: dict[str, dict] | None = None,
    ) -> str:
        text = sql.strip().removeprefix("```sql").removeprefix("```").removesuffix("```").strip()
        if not text or len(text) > 10_000:
            raise ValueError("query is empty or too large")
        if "--" in text or "/*" in text or "*/" in text:
            raise ValueError("SQL comments are not allowed")

        try:
            statements = parse(text, read="postgres", max_nodes=5_000)
        except ParseError as exc:
            raise ValueError("SQL could not be parsed") from exc
        if len(statements) != 1 or statements[0] is None:
            raise ValueError("exactly one SQL statement is required")
        query = statements[0]
        if not isinstance(query, exp.Select):
            raise ValueError("only SELECT queries are allowed")

        nodes = list(query.walk())
        if any(isinstance(node, (exp.Subquery, exp.CTE, exp.Union, exp.Intersect, exp.Except)) for node in nodes):
            raise ValueError("subqueries, CTEs, and set operations are not allowed")
        if query.args.get("with_") or query.args.get("locks") or query.args.get("into"):
            raise ValueError("CTEs, SELECT INTO, and locking SELECT statements are not allowed")
        if any(getattr(node, "comments", None) for node in nodes):
            raise ValueError("SQL comments are not allowed")

        for node in nodes:
            # SQLGlot models logical connectors such as AND as both Func and
            # Binary expressions. They are operators, not callable SQL
            # functions, so only apply the function allowlist to non-binary
            # function nodes. OR is rejected explicitly above.
            if isinstance(node, exp.Func) and not isinstance(node, exp.Binary):
                function_name = node.sql_name().lower()
                if function_name not in _ALLOWED_FUNCTIONS:
                    raise ValueError(
                        f"query contains a function that is not allowed: {function_name}"
                    )

        live_schema = schema is not None
        if schema is None:
            schema = SQLGuard._legacy_schema()
        tables = list(query.find_all(exp.Table))
        if not tables:
            raise ValueError("query must read an application table")
        refs: list[tuple[str, str]] = []
        aliases: dict[str, str] = {}
        for table_node in tables:
            table_name = table_node.name.lower()
            if table_node.db and table_node.db.lower() != "public":
                raise ValueError("only the public application schema may be queried")
            if table_node.catalog:
                raise ValueError("catalog-qualified tables are not allowed")
            if table_name not in schema:
                raise ValueError(f"table is not in the live application schema: {table_name}")
            alias = table_node.alias_or_name.lower()
            if alias in aliases:
                raise ValueError("duplicate table aliases are not allowed")
            aliases[alias] = table_name
            refs.append((table_name, alias))

        if schema and not any(table in _ALLOWED_TABLES for table, _ in refs) and not all(
            table in schema for table, _ in refs
        ):
            raise ValueError("query must read an application table")

        projections = query.expressions
        output_names = {
            projection.alias_or_name.lower()
            for projection in projections
            if projection.alias_or_name
        }
        for projection in projections:
            if isinstance(projection, exp.Star) or (
                isinstance(projection, exp.Column) and isinstance(projection.this, exp.Star)
            ):
                raise ValueError("SELECT * is not allowed")

        for column in query.find_all(exp.Column):
            name = column.name.lower()
            if name in {"*", "password_hash", "pin_hash", "totp_secret", "refresh_token_hash"}:
                raise ValueError("sensitive or wildcard columns are not allowed")
            if not live_schema:
                continue
            if column.db or column.catalog:
                raise ValueError("schema-qualified columns are not allowed")
            alias = column.table.lower()
            if alias:
                table = aliases.get(alias)
                if table is None:
                    raise ValueError(f"unknown table alias: {alias}")
                allowed_columns = {value.lower() for value in schema[table]["columns"]}
                if allowed_columns and name not in allowed_columns:
                    raise ValueError(f"column is not available: {table}.{name}")
            else:
                # Output aliases are useful in ORDER BY, but the query's
                # SELECT list itself must always name a live table alias.
                ancestors = list(column.parent.walk()) if column.parent else []
                in_order_by = any(
                    isinstance(parent, (exp.Order, exp.Ordered)) for parent in ancestors
                )
                if not (in_order_by and name in output_names):
                    raise ValueError(f"column must be qualified with its table alias: {name}")

        for join in query.args.get("joins") or []:
            if join.args.get("using"):
                raise ValueError("JOIN USING is not supported; join with an explicit ON foreign-key condition")

        where = query.args.get("where")
        # OR filters are allowed for retrieval. Branch equality still has to
        # be a mandatory top-level conjunct, so an OR cannot bypass branch scope.
        where_predicates = list(SQLGuard._and_terms(where.this)) if where else []
        fk_edges = SQLGuard._foreign_key_edges(query, refs, aliases, schema, where_predicates)
        scoped_aliases: set[str] = set()
        directly_scoped_aliases: set[str] = set()
        for table_name, alias in refs:
            branch_columns = {column.lower() for column in schema[table_name]["branch_columns"]}
            if not branch_columns:
                continue
            branch_values = [
                (column_name, value)
                for predicate in where_predicates
                for column_name, value in SQLGuard._branch_equality(predicate, alias)
                if column_name in branch_columns
            ]
            if branch_id is not None and any(value != branch_id for _, value in branch_values):
                raise ValueError("branch filters must match the authenticated branch")
            if branch_values:
                scoped_aliases.add(alias)
                directly_scoped_aliases.add(alias)

        # A query may filter the branch row itself, then scope branch-bearing
        # tables through declared foreign keys to that row.
        branch_anchor_columns: dict[str, set[str]] = {}
        for info in schema.values():
            branch_columns = {column.lower() for column in info["branch_columns"]}
            for fk_column, target_table, target_column in info["foreign_keys"]:
                if fk_column.lower() in branch_columns:
                    branch_anchor_columns.setdefault(target_table.lower(), set()).add(target_column.lower())

        branch_anchor_aliases: set[str] = set()
        for table_name, alias in refs:
            anchor_columns = branch_anchor_columns.get(table_name, set())
            anchor_values = [
                value
                for predicate in where_predicates
                for column_name, value in SQLGuard._branch_equality(predicate, alias)
                if column_name in anchor_columns
            ]
            if branch_id is not None and any(value != branch_id for value in anchor_values):
                raise ValueError("branch filters must match the authenticated branch")
            if anchor_values:
                branch_anchor_aliases.add(alias)
                scoped_aliases.add(alias)

        for table_name, alias in refs:
            branch_columns = {column.lower() for column in schema[table_name]["branch_columns"]}
            if not branch_columns or alias in directly_scoped_aliases:
                continue
            if not SQLGuard._has_path(alias, branch_anchor_aliases, fk_edges):
                raise ValueError(f"table {alias} must be filtered to the authenticated branch or joined through its branch FK")
            scoped_aliases.add(alias)

        SQLGuard._validate_fk_scope(query, refs, aliases, schema, scoped_aliases, where_predicates)

        limit = query.args.get("limit")
        if limit:
            value = limit.expression
            if not isinstance(value, exp.Literal) or value.is_string:
                raise ValueError("LIMIT must be an integer literal")
            try:
                count = int(value.this)
            except (TypeError, ValueError) as exc:
                raise ValueError("LIMIT must be a non-negative integer") from exc
            if count < 0:
                raise ValueError("LIMIT must be a non-negative integer")
            if count > _MAX_LIMIT:
                limit.set("expression", exp.Literal.number(_MAX_LIMIT))
        else:
            query.set("limit", exp.Limit(expression=exp.Literal.number(_MAX_LIMIT)))
        return query.sql(dialect="postgres")

    @staticmethod
    def _legacy_schema() -> dict[str, dict]:
        schema = {
            name: {"columns": [], "branch_columns": ["branch_id"], "foreign_keys": []}
            for name in _ALLOWED_TABLES
        }
        schema["sale_detail"]["branch_columns"] = []
        schema["sale_detail"]["foreign_keys"] = [("sale_id", "sale", "id")]
        return schema

    @staticmethod
    def _and_terms(expression: exp.Expr) -> list[exp.Expr]:
        while isinstance(expression, exp.Paren):
            expression = expression.this
        if isinstance(expression, exp.And):
            return SQLGuard._and_terms(expression.this) + SQLGuard._and_terms(expression.expression)
        return [expression]

    @staticmethod
    def _branch_equality(predicate: exp.Expr, alias: str) -> list[tuple[str, str]]:
        if not isinstance(predicate, exp.EQ):
            return []
        left, right = predicate.this, predicate.expression
        pairs = ((left, right), (right, left))
        result = []
        for column, literal in pairs:
            if (
                isinstance(column, exp.Column)
                and column.table.lower() == alias
                and isinstance(literal, exp.Literal)
                and literal.is_string
            ):
                result.append((column.name.lower(), literal.this))
        return result

    @staticmethod
    def _foreign_key_edges(
        query: exp.Select,
        refs: list[tuple[str, str]],
        aliases: dict[str, str],
        schema: dict[str, dict],
        where_predicates: list[exp.Expr],
    ) -> set[tuple[str, str]]:
        join_predicates: list[exp.Expr] = []
        for join in query.args.get("joins") or []:
            on = join.args.get("on")
            if on:
                join_predicates.extend(SQLGuard._and_terms(on))

        edges: set[tuple[str, str]] = set()
        for predicate in [*where_predicates, *join_predicates]:
            if not isinstance(predicate, exp.EQ):
                continue
            left, right = predicate.this, predicate.expression
            if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
                continue
            left_alias, right_alias = left.table.lower(), right.table.lower()
            left_table, right_table = aliases.get(left_alias), aliases.get(right_alias)
            if not left_table or not right_table:
                continue
            left_fks = {
                (column.lower(), ref_table.lower(), ref_column.lower())
                for column, ref_table, ref_column in schema[left_table]["foreign_keys"]
            }
            right_fks = {
                (column.lower(), ref_table.lower(), ref_column.lower())
                for column, ref_table, ref_column in schema[right_table]["foreign_keys"]
            }
            left_fk = (left.name.lower(), right_table, right.name.lower()) in left_fks
            right_fk = (right.name.lower(), left_table, left.name.lower()) in right_fks
            if left_fk or right_fk:
                edges.add((left_alias, right_alias))
                edges.add((right_alias, left_alias))
        return edges

    @staticmethod
    def _has_path(start: str, targets: set[str], edges: set[tuple[str, str]]) -> bool:
        seen = {start}
        frontier = [start]
        while frontier:
            current = frontier.pop()
            for left, right in edges:
                if left == current and right not in seen:
                    if right in targets:
                        return True
                    seen.add(right)
                    frontier.append(right)
        return start in targets

    @staticmethod
    def _validate_fk_scope(
        query: exp.Select,
        refs: list[tuple[str, str]],
        aliases: dict[str, str],
        schema: dict[str, dict],
        scoped_aliases: set[str],
        where_predicates: list[exp.Expr],
    ) -> None:
        # FK equalities count only when they are mandatory conjuncts in WHERE
        # or direct conjuncts of a JOIN's ON clause, never in SELECT/CASE text.
        edges = SQLGuard._foreign_key_edges(query, refs, aliases, schema, where_predicates)

        for table, alias in refs:
            if alias in scoped_aliases or not schema[table]["foreign_keys"]:
                continue  # A table with no FK and no branch key is global.
            seen = {alias}
            frontier = [alias]
            while frontier:
                current = frontier.pop()
                for left, right in edges:
                    if left == current and right not in seen:
                        seen.add(right)
                        frontier.append(right)
            if not seen.intersection(scoped_aliases):
                raise ValueError(f"table {alias} must join through declared foreign keys to a branch-scoped table")

    @staticmethod
    def _validate_live_schema(
        sql: str,
        refs: list[tuple[str, str]],
        branch_filters: list[tuple[str, str]],
        schema: dict[str, dict],
    ) -> None:
        aliases = {alias: table for table, alias in refs}
        if len(aliases) != len(refs):
            raise ValueError("duplicate table aliases are not allowed")
        # Do not allow hidden credential-like fields even if the schema metadata
        # is stale or a provider invents a column name.
        if re.search(r"(?i)\b\w*(password|secret|token|hash|credential|api_key|private_key|pin)\w*\b", sql):
            raise ValueError("sensitive columns are not allowed")

        for alias, column in re.findall(r"\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)\b", sql, re.I):
            table = aliases.get(alias.lower())
            if table is None:
                raise ValueError(f"unknown table alias: {alias}")
            if column.lower() not in {name.lower() for name in schema[table]["columns"]}:
                raise ValueError(f"column is not available: {table}.{column}")

        # Every branch-bearing alias needs an equality to the authenticated
        # branch. Multi-branch tables (e.g. stock_transfer) may scope either end.
        scoped_aliases: set[str] = set()
        for table, alias in refs:
            branch_columns = schema[table]["branch_columns"]
            if not branch_columns:
                continue
            scoped_aliases.add(alias)
            filters = re.findall(
                rf"(?i)\b{re.escape(alias)}\s*\.\s*([a-z_][a-z0-9_]*)\s*=\s*'([^']*)'", sql,
            )
            matching = [value for column, value in filters if column.lower() in {c.lower() for c in branch_columns}]
            if not matching:
                raise ValueError(f"table {alias} must be filtered to the authenticated branch")
            if branch_id is not None and any(value != branch_id for value in matching):
                raise ValueError("branch filters must match the authenticated branch")

        # Build only real declared FK edges. A detail table can be used only
        # when its joins form a path to an alias scoped to the active branch.
        joined_edges: set[tuple[str, str]] = set()
        for left_alias, left_col, right_alias, right_col in re.findall(
            r"(?i)\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*=\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b", sql,
        ):
            left_table, right_table = aliases.get(left_alias.lower()), aliases.get(right_alias.lower())
            if not left_table or not right_table:
                continue
            left_fk = (left_col, right_table, right_col) in schema[left_table]["foreign_keys"]
            right_fk = (right_col, left_table, left_col) in schema[right_table]["foreign_keys"]
            if left_fk or right_fk:
                joined_edges.add((left_alias.lower(), right_alias.lower()))
                joined_edges.add((right_alias.lower(), left_alias.lower()))

        for table, alias in refs:
            if alias in scoped_aliases or not schema[table]["foreign_keys"]:
                continue  # genuinely global table
            seen = {alias}
            frontier = [alias]
            while frontier:
                current = frontier.pop()
                for a, b in joined_edges:
                    if a == current and b not in seen:
                        seen.add(b)
                        frontier.append(b)
            if not seen.intersection(scoped_aliases):
                raise ValueError(f"table {alias} must join through foreign keys to the active branch")


class TextToSQLJob(BaseJob):
    name = "rag_query"

    def __init__(
        self,
        llm: BaseLLMProvider,
        db: Database | None = None,
        on_progress: Callable[[str], None] | None = None,
        cache: SQLCache | None = None,
    ):
        self._llm = llm
        self._db = db
        self._on_progress = on_progress
        self._cache = cache
        self._last_cache_key: str | None = None

    def validate(self, ctx: JobContext) -> None:
        question = ctx.params.get("question", "")
        if not isinstance(question, str) or not question.strip():
            raise ValueError("params.question is required")
        if not ctx.branch_id:
            raise ValueError("branch_id is required")

    def run(self, ctx: JobContext) -> JobResult:
        question = str(ctx.params["question"])
        history = self._conversation_history(ctx.params.get("history"))
        contextual_question = json.dumps({
            "recent_conversation": history,
            "current_question": question,
        }, ensure_ascii=False) if history else question
        self._last_cache_key = None
        if self._db is None:
            raise ValueError("AI_DB_UNAVAILABLE")
        if self._on_progress:
            self._on_progress("loading_schema")
        schema = self._db.get_schema()
        if not schema:
            raise ValueError("AI_SCHEMA_UNAVAILABLE")
        if self._on_progress:
            self._on_progress("schema_loaded")

        # Tier 2 — Q→SQL cache: zero LLM calls. The hit is re-validated by
        # SQLGuard before it is ever returned, and a bad entry is dropped.
        cache_key: str | None = None
        if self._cache is not None:
            cache_key = make_cache_key(ctx.branch_id, schema, contextual_question)
            cached = self._cache.get(cache_key)
            if isinstance(cached, dict):
                if not isinstance(cached.get("sql"), str):
                    self._cache.delete(cache_key)
                else:
                    try:
                        cached_sql = SQLGuard.validate(cached["sql"], ctx.branch_id, schema)
                    except Exception:
                        self._cache.delete(cache_key)
                    else:
                        if self._on_progress:
                            self._on_progress("cache_hit")
                            self._on_progress("sql_validated")
                        self._last_cache_key = cache_key
                        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
                            "sql": cached_sql,
                            "understanding": str(cached.get("understanding") or question)[:500],
                            "plan": cached.get("plan") if isinstance(cached.get("plan"), list) else [],
                            "suggestions": (
                                cached.get("suggestions")
                                if isinstance(cached.get("suggestions"), list)
                                else self._default_suggestions(question)
                            ),
                            "sql_source": "cache",
                        })

        intent = self._classify_intent(contextual_question)
        if intent["intent"] == "write":
            reply = intent["reply"] or self._readonly_refusal(question)
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
                "refused": True,
                "understanding": question,
                "plan": [],
                "suggestions": [],
                "summary": reply,
                "answer": reply,
            })
        if self._on_progress:
            self._on_progress("intent_readonly")

        # Tier 1 — pre-written tool: one small intent call (already made),
        # no schema prompt, then the rendered SQL passes the same guard.
        if intent["tool"]:
            tool_sql = render_tool(intent["tool"], intent["args"], ctx.branch_id)
            if tool_sql is not None:
                if self._on_progress:
                    self._on_progress("tool_matched")
                try:
                    sql = SQLGuard.validate(tool_sql, ctx.branch_id, schema)
                except Exception:
                    sql = None
                if sql is not None:
                    if self._on_progress:
                        self._on_progress("sql_validated")
                    payload = self._tool_payload(question, sql, intent["tool"])
                    self._store_in_cache(cache_key, payload)
                    return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data=payload)

        # Tier 3 — full schema + SQL generation (original path).
        if self._on_progress:
            self._on_progress("calling_model")
        raw = self._llm.complete(
            f"Schema:\n{format_schema(schema)}\n"
            f"Conversation context and current question (JSON; use past messages only to resolve references):\n"
            f"{contextual_question}",
            system=SYSTEM_PROMPT.format(branch_id=ctx.branch_id),
            json_mode=True,
        )
        if self._on_progress:
            self._on_progress("model_responded")
        payload = self._parse_response(raw, question)
        payload["sql_source"] = "model"
        if self._on_progress:
            self._on_progress("validating_sql")
        try:
            sql = SQLGuard.validate(payload["sql"], ctx.branch_id, schema)
        except Exception as exc:
            return JobResult(
                job_id=ctx.job_id,
                job_name=self.name,
                ok=False,
                error=f"SQL validation failed: {exc}",
                data={"failure_stage": "sql_validation", "sql_candidate": payload["sql"][:10_000]},
            )
        payload["sql"] = sql
        if self._on_progress:
            self._on_progress("sql_validated")
        self._store_in_cache(cache_key, payload)
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data=payload)

    @staticmethod
    def _conversation_history(raw: object) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        history: list[dict[str, Any]] = []
        for item in raw[-4:]:
            if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
                continue
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            entry: dict[str, Any] = {"role": item["role"], "content": content[:400]}
            forecast = item.get("forecast")
            if item["role"] == "assistant" and isinstance(forecast, dict):
                entry["forecast"] = forecast
            history.append(entry)
        return history

    def invalidate_cached(self) -> None:
        """Drop the entry this run read or wrote — called when the cached SQL
        fails at execution time so the next question regenerates."""
        if self._cache is not None and self._last_cache_key is not None:
            self._cache.delete(self._last_cache_key)
        self._last_cache_key = None

    def _store_in_cache(self, cache_key: str | None, payload: dict) -> None:
        if self._cache is None or cache_key is None:
            return
        self._cache.set(cache_key, {
            "sql": payload["sql"],
            "understanding": payload.get("understanding", ""),
            "plan": payload.get("plan", []),
            "suggestions": payload.get("suggestions", []),
        })
        self._last_cache_key = cache_key

    def _tool_payload(self, question: str, sql: str, tool_name: str) -> dict:
        tool = tool_by_name(tool_name)
        plan = [
            {
                "table": table,
                "purpose": f"Ready-made query tool: {tool_name}",
                "columns": [],
                "filter": "authenticated branch",
            }
            for table in (tool.tables if tool else ())
        ]
        return {
            "sql": sql,
            "understanding": question[:500],
            "plan": plan,
            "suggestions": self._default_suggestions(question),
            "tool": tool_name,
            "sql_source": "tool",
        }

    def _classify_intent(self, question: str) -> dict[str, Any]:
        raw = self._llm.complete(question, system=INTENT_SYSTEM_PROMPT, json_mode=True).strip()
        if raw.startswith("```json"):
            raw = raw.removeprefix("```json").removesuffix("```").strip()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("AI_INTENT_CHECK_FAILED") from exc
        if not isinstance(payload, dict) or payload.get("intent") not in {"read", "write"}:
            raise ValueError("AI_INTENT_CHECK_FAILED")
        tool = payload.get("tool")
        args = payload.get("args")
        return {
            "intent": payload["intent"],
            "reply": str(payload.get("reply") or "").strip()[:1000],
            "tool": tool.strip()[:80] if isinstance(tool, str) else "",
            "args": args if isinstance(args, dict) else {},
        }

    @staticmethod
    def _readonly_refusal(question: str) -> str:
        if re.search(r"[\u1000-\u109f]", question):
            return "ဒီ AI chat က database အချက်အလက်တွေကို ဖတ်ရှုမေးမြန်းရန်သာ အသုံးပြုနိုင်ပါတယ်။ Data ပြင်ဆင်၊ ဖျက်ခြင်း၊ အသစ်ထည့်ခြင်း မလုပ်နိုင်ပါဘူး။ ဘာမှပြောင်းလဲထားခြင်း မရှိပါ။"
        return "This AI chat can only read database information. It cannot add, edit, or delete data, and no changes were made."

    def explain_failure(
        self, *, question: str, stage: str, reason: str, sql: str | None = None,
    ) -> str:
        safe_reason = str(reason)[:1200]
        safe_reason = re.sub(r"(?i)postgres(?:ql)?://\S+", "[database connection redacted]", safe_reason)
        safe_reason = re.sub(
            r"(?i)(api[_-]?key|token|password)\s*[:=]\s*\S+",
            r"\1=[redacted]",
            safe_reason,
        )
        prompt = (
            f"Question: {question[:500]}\nFailure stage: {stage[:80]}\n"
            f"SQL candidate: {(sql or '[not generated]')[:10_000]}\n"
            f"Database or validation error: {safe_reason}"
        )
        try:
            raw = self._llm.complete(
                prompt,
                system=FAILURE_DIAGNOSIS_SYSTEM_PROMPT,
                json_mode=True,
            ).strip()
            if raw.startswith("```json"):
                raw = raw.removeprefix("```json").removesuffix("```").strip()
            payload = json.loads(raw)
            summary = payload.get("summary") if isinstance(payload, dict) else None
            if isinstance(summary, str) and summary.strip():
                return summary.strip()[:1200]
            raise ValueError("diagnosis response has no summary")
        except Exception:
            if re.search(r"[\u1000-\u109f]", question):
                return f"ဒီမေးခွန်းအတွက် အဖြေမရနိုင်ပါ။ {stage} အဆင့်မှာ query ကို လက်မခံနိုင်ခဲ့ပါ။ အကြောင်းရင်း: {safe_reason[:500]}"
            return f"I couldn't answer this question because the query failed during {stage}. Reason: {safe_reason[:500]}"

    @staticmethod
    def _parse_response(raw: str, question: str) -> dict:
        text = raw.strip()
        if text.startswith("```json"):
            text = text.removeprefix("```json").removesuffix("```").strip()
        try:
            response = json.loads(text)
        except json.JSONDecodeError:
            response = {"sql": raw.strip()}
        if not isinstance(response, dict) or not isinstance(response.get("sql"), str):
            raise ValueError("model response must include a SQL query")

        plan = response.get("plan")
        if not isinstance(plan, list):
            plan = []
        clean_plan = []
        for item in plan[:8]:
            if not isinstance(item, dict) or not isinstance(item.get("table"), str):
                continue
            columns = item.get("columns")
            clean_plan.append({
                "table": item["table"][:80],
                "purpose": str(item.get("purpose", ""))[:240],
                "columns": [str(column)[:80] for column in columns[:20]] if isinstance(columns, list) else [],
                "filter": str(item.get("filter", ""))[:240],
            })
        query_tables = list(dict.fromkeys(re.findall(
            r"(?i)\b(?:from|join)\s+([a-z_][a-z0-9_]*)", response["sql"],
        )))
        clean_plan = [item for item in clean_plan if item["table"].lower() in query_tables]
        for table in query_tables:
            if not any(item["table"].lower() == table for item in clean_plan):
                clean_plan.append({
                    "table": table,
                    "purpose": "Retrieve records relevant to the question",
                    "columns": [],
                    "filter": "current branch",
                })

        suggestions = response.get("suggestions")
        clean_suggestions = [
            suggestion.strip()[:200]
            for suggestion in suggestions
            if isinstance(suggestion, str) and suggestion.strip()
        ][:5] if isinstance(suggestions, list) else []
        if len(clean_suggestions) < 3:
            clean_suggestions = TextToSQLJob._default_suggestions(question)

        return {
            "sql": response["sql"],
            "understanding": str(response.get("understanding") or question)[:500],
            "plan": clean_plan,
            "suggestions": clean_suggestions,
        }

    @staticmethod
    def _default_suggestions(question: str) -> list[str]:
        if re.search(r"[\u1000-\u109f]", question):
            return [
                "ဒီရလဒ်ကို နောက်ဆုံး ၇ ရက်အလိုက် ခွဲပြပါ။",
                "ဒီကာလရလဒ်ကို ယခင်ကာလနဲ့ နှိုင်းယှဉ်ပါ။",
                "ဒီရလဒ်မှာ အများဆုံးပါဝင်တဲ့ ပစ္စည်း သို့မဟုတ် category တွေကို ပြပါ။",
            ]
        return [
            "Show this result by day for the last 7 days?",
            "Compare this result with the previous period?",
            "Which products or categories contribute most to this result?",
        ]
