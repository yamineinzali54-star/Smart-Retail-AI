import "server-only";

import { getTableColumns } from "drizzle-orm";
import { NextResponse } from "next/server";
import postgres from "postgres";

import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { BACKUP_TABLES, RESTORE_ORDER } from "@/lib/backup";

// Restore from a backup JSON file. Replays rows in dependency order.
// Table keys are REAL SQL names (see lib/backup.ts) — the old restore used
// drizzle var names as SQL names and targeted tables that don't exist.
// This is a DESTRUCTIVE operation — it will overwrite existing data.
// Requires admin role + explicit confirmation.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.tables || typeof body.tables !== "object") {
    return NextResponse.json({ ok: false, error: "INVALID_BACKUP_FORMAT" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json({ ok: false, error: "CONFIRMATION_REQUIRED" }, { status: 400 });
  }

  const tables = body.tables as Record<string, Record<string, unknown>[]>;
  const unknown = Object.keys(tables).filter((k) => !(k in BACKUP_TABLES));
  if (unknown.length > 0) {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_TABLES", tables: unknown },
      { status: 400 },
    );
  }

  const results: Record<string, number> = {};

  const sql = postgres(process.env.DATABASE_URL ?? "");

  // NOTE: no `SET session_replication_role` — Neon denies it without
  // superuser. FK safety comes from RESTORE_ORDER (parents before children)
  // plus ON CONFLICT DO NOTHING; snapshots are self-consistent by export.
  try {
    for (const tableName of RESTORE_ORDER) {
      const rows = tables[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Backup rows are keyed by drizzle field names (camelCase); map to
      // real SQL column names and quote them. Unknown keys fail fast so
      // format drift surfaces instead of silently corrupting data.
      const columnDefs = getTableColumns(BACKUP_TABLES[tableName]);
      for (const row of rows) {
        const keys = Object.keys(row);
        const sqlNames = keys.map((k) => {
          const col = (columnDefs as Record<string, { name: string }>)[k];
          if (!col) throw new Error(`Unknown column "${k}" for table "${tableName}"`);
          return `"${col.name}"`;
        });
        const values = Object.values(row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        await sql.unsafe(
          `INSERT INTO "${tableName}" (${sqlNames.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values as (string | number | boolean | null)[],
        );
      }
      results[tableName] = rows.length;
    }

    await sql.end();

    await audit({
      entityType: "Backup",
      entityId: session.user.branchId,
      action: "create",
      description: `Restored backup (${Object.values(results).reduce((s, n) => s + n, 0)} rows)`,
      newValues: results,
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });

    return NextResponse.json({ ok: true, restored: results });
  } catch (err) {
    await sql.end();
    const message = err instanceof Error ? err.message : "Restore failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
