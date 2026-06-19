import { NextRequest, NextResponse } from "next/server";
import { saveIncomeExpense } from "@/lib/server/lanflow-db";
import type { IncomeExpense } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const transaction = await request.json() as IncomeExpense;
    const savedTransaction = await saveIncomeExpense(transaction);
    return NextResponse.json(savedTransaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
