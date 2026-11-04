import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { addUserMessage } from "@/lib/ai-chat";

const messageSchema = z.object({ question: z.string().trim().min(1).max(500) });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  const parsed = messageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  const { id } = await context.params;
  const message = await addUserMessage({
    conversationId: id,
    userId: session.user.id,
    branchId: session.user.branchId,
    question: parsed.data.question,
  });
  if (!message) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, message }, { status: 201 });
}
