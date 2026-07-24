import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  const { id } = await params;
  const { error } = await authCheck.supabase.rpc(
    "delete_rubber_bill_approval_request",
    { p_request_id: id }
  );

  if (error) {
    return NextResponse.json({ errorMessage: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "deleted", requestId: id });
}
