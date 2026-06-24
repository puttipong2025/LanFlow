import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { saveIncomeExpense } from "@/lib/server/lanflow-db";
import type { IncomeExpense } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const input = await request.json() as IncomeExpense;
    const transaction: IncomeExpense = {
      ...input,
      createdByName: result.auth.name,
      createdByPhone: result.auth.phone,
      ...(input.recordStatus === "deleted"
        ? {
            deletedByName: result.auth.name,
            deletedByPhone: result.auth.phone
          }
        : {})
    };
    const savedTransaction = await saveIncomeExpense(result.supabase, transaction, result.auth.sub);
    return NextResponse.json(savedTransaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
