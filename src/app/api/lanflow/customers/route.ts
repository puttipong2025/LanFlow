import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { saveCustomer, getCustomersPaginated } from "@/lib/server/lanflow-db";
import type { Customer } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    
    const result = await getCustomersPaginated(page, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const customer = await request.json() as Customer;
    const saved = await saveCustomer(customer, result.auth.sub);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

