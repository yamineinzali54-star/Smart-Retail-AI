import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

const TEMPLATE = [
  "name,short_name,tax_rate,is_tax_exempt",
  "Beverages,BEV,5.00,false",
  "Grocery,GRO,5.00,false",
].join("\n");

export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  return new NextResponse(TEMPLATE, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=categories-import-template.csv",
    },
  });
}
