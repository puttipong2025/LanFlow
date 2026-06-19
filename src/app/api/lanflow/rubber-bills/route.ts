import { NextRequest, NextResponse } from "next/server";
import { saveRubberBill } from "@/lib/server/lanflow-db";
import type { RubberBill } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const bill = await request.json() as RubberBill;
    const savedBill = await saveRubberBill(bill);
    return NextResponse.json(savedBill);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
