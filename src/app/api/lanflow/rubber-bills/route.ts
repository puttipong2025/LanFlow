import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { saveRubberBill } from "@/lib/server/lanflow-db";
import type { RubberBill } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const bill = await request.json() as RubberBill;
    const savedBill = await saveRubberBill(bill, result.auth.sub);
    return NextResponse.json(savedBill);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
