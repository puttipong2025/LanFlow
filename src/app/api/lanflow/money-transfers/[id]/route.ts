import { NextRequest, NextResponse } from "next/server";
import { deleteMoneyTransfer } from "@/lib/server/lanflow-db";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const { id } = await params;
    await deleteMoneyTransfer(result.supabase, id, result.auth.sub);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
