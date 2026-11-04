import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createEmployeeSchema = z.object({
  userName: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(100),
  fullName: z.string().trim().min(1).max(100),
  email: z.string().email().max(150).optional().nullable(),
  role: z.enum(["inventory", "cashier"]),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const employees = await db
    .select({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.role, "inventory"))
    .union(
      db
        .select({
          id: users.id,
          userName: users.userName,
          fullName: users.fullName,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.role, "cashier"))
    );

  const result = paginateArray(employees, page, pageSize);
  return NextResponse.json({ ok: true, employees: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createEmployeeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { userName, password, fullName, email, role } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.userName, userName))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ ok: false, error: "USERNAME_EXISTS" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const [newUser] = await db
    .insert(users)
    .values({
      branchId: session.user.branchId,
      userName,
      passwordHash,
      fullName,
      email: email ?? null,
      role,
      isActive: true,
    })
    .returning({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });

  await audit({
    entityType: "User",
    entityId: newUser.id,
    action: "create",
    description: `Created employee: ${userName} (${role})`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, employee: newUser }, { status: 201 });
}
