import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

type PrintStatusRpcResult = {
  status?: string;
  errorMessage?: string;
  id?: string;
  printStatus?: string;
  revisionNo?: number;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return authCheck.response;

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ status: "failed", errorMessage: "Invalid Rubber Bill ID" }, { status: 400 });
  }

  const { data, error } = await authCheck.supabase.rpc("mark_rubber_bill_printed", {
    p_bill_id: id
  });
  if (error) {
    console.error("RPC mark_rubber_bill_printed error:", error);
    return NextResponse.json({ status: "failed", errorMessage: error.message }, { status: 500 });
  }

  const result = (data ?? {}) as PrintStatusRpcResult;
  if (result.status === "synced") return NextResponse.json(result);
  return NextResponse.json(
    { status: "failed", errorMessage: result.errorMessage || "บันทึกสถานะการพิมพ์ไม่สำเร็จ" },
    { status: result.errorMessage === "Location access denied" ? 403 : 400 }
  );
}
