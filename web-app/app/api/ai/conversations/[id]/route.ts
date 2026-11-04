import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { deleteConversation, getConversation } from "@/lib/ai-chat";

type RouteContext = { params: Promise<{ id: string }> };

async function authorizedSession() {
  const session = await getSession();
  if (!session) return { ok: false as const, response: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await authorizedSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const conversation = await getConversation(auth.session.user.id, auth.session.user.branchId, id);
  if (!conversation) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, conversation });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await authorizedSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const deleted = await deleteConversation(auth.session.user.id, auth.session.user.branchId, id);
  if (!deleted) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
