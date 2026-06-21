import { NextRequest, NextResponse } from "next/server";
import { saveCustomer } from "@/lib/server/lanflow-db";
import type { Customer } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const customer = await request.json() as Customer;
    const saved = await saveCustomer(customer);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
