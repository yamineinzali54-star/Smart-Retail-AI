import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { branches, userBranches } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Branches the caller may work in: explicit grants plus the home branch.
// Used by the sidebar branch switcher.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const grants = await db
    .select({ branchId: userBranches.branchId })
    .from(userBranches)
    .where(eq(userBranches.userId, session.user.id));

  const ids = [...new Set([session.user.branchId, ...grants.map((g) => g.branchId)])];
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({ id: branches.id, code: branches.code, name: branches.name })
          .from(branches)
          .where(and(inArray(branches.id, ids)));

  return NextResponse.json({
    ok: true,
    branches: rows,
    activeBranchId: session.user.branchId,
  });
}
