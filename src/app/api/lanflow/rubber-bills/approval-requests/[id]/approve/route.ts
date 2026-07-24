import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  const { id } = await params;
  const { data, error } = await authCheck.supabase.rpc(
    "approve_rubber_bill_approval_request",
    { p_request_id: id }
  );

  if (error) {
    return NextResponse.json({ errorMessage: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
