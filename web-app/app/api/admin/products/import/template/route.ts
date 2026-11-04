import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

const TEMPLATE = [
  "name,category_name,unit_name,reorder_threshold",
  "Coca Cola 330ml,Beverages,PCS,10",
  "Rice 5kg,Grocery,PCS,5",
].join("\n");

export async function GET() {
  const session = await getSession();
  if (
    !session ||
    (session.user.role !== "admin" && session.user.role !== "inventory")
  ) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  return new NextResponse(TEMPLATE, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=products-import-template.csv",
    },
  });
}
