import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { carts, posSessions } from "@/db/schema";
import {
  clearAuthCookies,
  getClientIp,
  getSession,
  revokeAllUserSessions,
} from "@/lib/auth";
import { audit } from "@/lib/audit";

// POST /api/auth/logout (§6.1, §7.1)
// - Revokes ALL of the user's refresh sessions (logout actually logs out).
// - Auto-closes active POS session(s): status=closed, end_time=now,
//   cart cleared, audit `close` with the cash reconciliation values.
export async function POST() {
  const session = await getSession();
  const ip = await getClientIp();

  if (session) {
    await revokeAllUserSessions(session.user.id);

    const active = await db
      .select()
      .from(posSessions)
      .where(
        and(
          eq(posSessions.userId, session.user.id),
          eq(posSessions.status, "active"),
        ),
      );

    for (const s of active) {
      const now = new Date();
      await db
        .update(posSessions)
        .set({ status: "closed", endTime: now })
        .where(eq(posSessions.id, s.id));

      // Clear the persisted cart for the auto-closed session (§6.1).
      const [cart] = await db
        .select()
        .from(carts)
        .where(eq(carts.posSessionId, s.id))
        .limit(1);
      if (cart) {
        await db.delete(carts).where(eq(carts.id, cart.id));
      }

      await audit({
        entityType: "POSSession",
        entityId: s.id,
        action: "close",
        description: "Auto-close on logout",
        newValues: {
          status: "closed",
          endTime: now.toISOString(),
          openingCash: s.openingCash,
          expectedClosingCash: s.expectedClosingCash,
          actualClosingCash: s.actualClosingCash,
          cashDifference: s.cashDifference,
        },
        userId: session.user.id,
        branchId: session.user.branchId,
        ipAddress: ip,
      });
    }
  }

  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
