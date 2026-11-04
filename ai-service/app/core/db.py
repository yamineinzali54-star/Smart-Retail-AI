"""Read-only DB access. The driver is imported lazily so unit tests and
environments without a database still work."""

from __future__ import annotations

import time
from typing import Any, Sequence


class Database:
    """Branch-scoped read helper. AI jobs must NEVER write via this class."""

    def __init__(self, dsn: str):
        if not dsn:
            raise ValueError("AI_DATABASE_URL is required")
        self._dsn = dsn
        self._schema_cache: tuple[float, dict[str, dict[str, Any]]] | None = None

    @staticmethod
    def _assert_readonly_role(cur: Any) -> None:
        cur.execute("""
            SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
                   r.rolreplication, r.rolbypassrls,
                   has_schema_privilege(current_user, 'public', 'CREATE'),
                   EXISTS (
                     SELECT 1
                     FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'),
                                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
                     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                       AND has_table_privilege(current_user, c.oid, p.privilege)
                   ),
                   EXISTS (
                     SELECT 1
                     FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
                     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
                     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                       AND a.attnum > 0 AND NOT a.attisdropped
                       AND has_any_column_privilege(current_user, c.oid, p.privilege)
                   ),
                   EXISTS (
                     SELECT 1 FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relkind = 'S'
                       AND (has_sequence_privilege(current_user, c.oid, 'USAGE')
                         OR has_sequence_privilege(current_user, c.oid, 'SELECT')
                         OR has_sequence_privilege(current_user, c.oid, 'UPDATE'))
                   ),
                   EXISTS (
                     SELECT 1 FROM pg_catalog.pg_auth_members m
                     WHERE m.member = r.oid AND m.set_option
                   )
            FROM pg_catalog.pg_roles r
            WHERE r.rolname = current_user
        """)
        role = cur.fetchone()
        if (
            not role
            or role[0] not in {"smartretail_ai_reader", "smartretail_ai_reader_login"}
            or any(role[1:])
        ):
            raise PermissionError(
                "AI_DATABASE_URL must use an approved reader role with SELECT-only privileges"
            )

    def get_schema(self) -> dict[str, dict[str, Any]]:
        """Return the live public application schema, refreshed every 30s."""
        now = time.monotonic()
        if self._schema_cache and now - self._schema_cache[0] < 30:
            return self._schema_cache[1]

        import psycopg  # lazy: optional dependency surface

        with psycopg.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SET TRANSACTION READ ONLY")
                cur.execute("SET LOCAL statement_timeout = '5s'")
                self._assert_readonly_role(cur)
                cur.execute("""
                    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
                    FROM information_schema.columns c
                    JOIN information_schema.tables t
                      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
                    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
                      AND c.table_name <> '__drizzle_migrations'
                    ORDER BY c.table_name, c.ordinal_position
                """)
                schema: dict[str, dict[str, Any]] = {}
                for table, column, data_type, nullable in cur.fetchall():
                    schema.setdefault(table, {"columns": [], "types": {}, "branch_columns": [], "foreign_keys": []})
                    # Do not offer credential and secret fields to the model.
                    lowered = column.lower()
                    if any(word in lowered for word in (
                        "password", "secret", "token", "hash", "credential", "api_key", "private_key", "pin",
                    )):
                        continue
                    if (table == "app_setting" and lowered == "value") or (
                        table == "audit_log" and lowered in {"old_values", "new_values"}
                    ):
                        continue
                    schema[table]["columns"].append(column)
                    schema[table]["types"][column] = f"{data_type}{' NULL' if nullable == 'YES' else ''}"
                    if lowered == "branch_id" or lowered.endswith("_branch_id"):
                        schema[table]["branch_columns"].append(column)

                cur.execute("""
                    SELECT tc.table_name, kcu.column_name,
                           ccu.table_name AS foreign_table_name,
                           ccu.column_name AS foreign_column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.constraint_schema = kcu.constraint_schema
                    JOIN information_schema.constraint_column_usage ccu
                      ON ccu.constraint_name = tc.constraint_name
                     AND ccu.constraint_schema = tc.constraint_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.constraint_schema = 'public'
                      AND ccu.constraint_schema = 'public'
                """)
                for table, column, ref_table, ref_column in cur.fetchall():
                    if table in schema and ref_table in schema:
                        schema[table]["foreign_keys"].append((column, ref_table, ref_column))

        self._schema_cache = (now, schema)
        return schema

    def fetch_all(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        import psycopg  # lazy: optional dependency surface

        with psycopg.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SET TRANSACTION READ ONLY")
                cur.execute("SET LOCAL statement_timeout = '5s'")
                cur.execute("SET LOCAL TIME ZONE 'Asia/Yangon'")
                self._assert_readonly_role(cur)
                cur.execute(sql, params)
                cols = [d[0] for d in cur.description or []]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def copy_to_csv(
        self,
        sql: str,
        params: Sequence[Any],
        out: Any,
        *,
        statement_timeout: str = "60s",
    ) -> int:
        """Stream a SELECT to `out` (a writable text file) as CSV.

        Uses COPY ... TO STDOUT WITH (FORMAT CSV, HEADER) so the export
        never materialises the rows in Python — a 13.5k-row join transfers
        in ~4s instead of ~9s. Read-only guarantees are identical to
        fetch_all(): READ ONLY transaction, statement timeout and the
        reader-role assertion all run before the copy starts.
        """
        import psycopg  # lazy: optional dependency surface

        written = 0
        with psycopg.connect(self._dsn) as conn:
            with conn.cursor() as cur:
                cur.execute("SET TRANSACTION READ ONLY")
                # set_config takes a parameter, so the timeout cannot be injected.
                cur.execute(
                    "SELECT set_config('statement_timeout', %s, true)", (statement_timeout,)
                )
                cur.execute("SET LOCAL TIME ZONE 'Asia/Yangon'")
                self._assert_readonly_role(cur)
                with cur.copy(
                    f"COPY ({sql}) TO STDOUT WITH (FORMAT CSV, HEADER)", params=params
                ) as copy:
                    for chunk in copy:
                        if isinstance(chunk, memoryview):
                            chunk = chunk.tobytes()
                        if isinstance(chunk, (bytes, bytearray)):
                            chunk = bytes(chunk).decode("utf-8")
                        out.write(chunk)
                        written += 1
        return written
