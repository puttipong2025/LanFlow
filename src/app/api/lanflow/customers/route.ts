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
    
    const pageResult = await getCustomersPaginated(result.supabase, page, pageSize);
    return NextResponse.json(pageResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const input = await request.json() as Customer;
    const customer: Customer = {
      ...input,
      createdByUserId: result.auth.sub,
      createdByName: result.auth.name,
      createdByPhone: result.auth.phone
    };
    const saved = await saveCustomer(result.supabase, customer, result.auth.sub);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

