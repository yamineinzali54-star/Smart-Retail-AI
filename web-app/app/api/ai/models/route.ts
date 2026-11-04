import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getAiModels } from "@/lib/ai-model-settings";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const now = new Date();
  const models = (await getAiModels()).filter((model) =>
    model.enabled && (!model.expiresAt || model.expiresAt > now),
  );
  return NextResponse.json({
    ok: true,
    models: models.map((model) => ({
        id: model.id,
        provider: model.provider,
        name: model.name,
        displayName: model.displayName,
        isDefault: model.isDefault,
      })),
  });
}
