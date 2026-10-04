import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";

export async function POST(request: Request) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return authCheck.response;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ disposition: "failed", errorMessage: "ข้อมูลบิลยางไม่ถูกต้อง" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("preview_rubber_bill_submission", { payload });
  if (error || !data || typeof data !== "object") {
    return NextResponse.json(
      { disposition: "failed", errorMessage: "ตรวจสอบกติกาบิลยางไม่สำเร็จ" },
      { status: 503 },
    );
  }
  const result = data as Record<string, unknown>;
  return NextResponse.json(result, {
    status: result.disposition === "failed" ? 400 : 200,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
