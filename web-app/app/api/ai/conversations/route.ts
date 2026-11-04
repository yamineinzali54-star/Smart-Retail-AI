import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/ai-chat";

const createSchema = z.object({ question: z.string().trim().min(1).max(500) });

async function authorizedSession() {
  const session = await getSession();
  if (!session) return { ok: false as const, response: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function GET() {
  const auth = await authorizedSession();
  if (!auth.ok) return auth.response;
  const conversations = await listConversations(auth.session.user.id, auth.session.user.branchId);
  return NextResponse.json({ ok: true, conversations });
}

export async function POST(req: Request) {
  const auth = await authorizedSession();
  if (!auth.ok) return auth.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const created = await createConversation({
    userId: auth.session.user.id,
    branchId: auth.session.user.branchId,
    question: parsed.data.question,
  });
  return NextResponse.json({ ok: true, ...created }, { status: 201 });
}
