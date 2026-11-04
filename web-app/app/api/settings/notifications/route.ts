import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";

const updateNotificationsSchema = z.object({
  telegramEnabled: z.boolean().optional(),
  lowStockAlerts: z.boolean().optional(),
  expiryAlerts: z.boolean().optional(),
  cashDiscrepancyAlerts: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = updateNotificationsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, settings: parsed.data });
}
