import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const createUserSchema = z.object({
  userName: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(100),
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "inventory", "cashier"]),
  branchId: z.string().uuid(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const staff = await db
    .select({ id: users.id, userName: users.userName, fullName: users.fullName, role: users.role, branchId: users.branchId, isActive: users.isActive })
    .from(users)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, staff, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { userName, password, fullName, role, branchId } = parsed.data;
  const passwordHash = await hash(password, 10);
  const [newUser] = await db
    .insert(users)
    .values({ userName, passwordHash, fullName, role, branchId, isActive: true })
    .returning({ id: users.id, userName: users.userName, fullName: users.fullName, role: users.role, branchId: users.branchId, isActive: users.isActive });
  await audit({
    entityType: "User",
    entityId: newUser.id,
    action: "create",
    description: `Created staff: ${userName} (${role})`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });
  return NextResponse.json({ ok: true, user: newUser }, { status: 201 });
}
