import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().email().max(150).optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: session.user.id,
      userName: session.user.userName,
      fullName: session.user.userName,
      role: session.user.role,
    },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = updateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: session.user.id,
      userName: session.user.userName,
      fullName: parsed.data.fullName,
      role: session.user.role,
    },
  });
}
