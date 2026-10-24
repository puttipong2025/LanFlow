import { cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
import { requireSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { downloadPrivateImageFromDrive } from "@/lib/server/google-drive";
import { isUuid } from "@/lib/server/management-route-error";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ countId: string }> }) {
  try {
    const auth = await requireSystemManager(request);
    if (!auth.ok) return auth.response;
    const { countId } = await context.params;
    if (!isUuid(countId)) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
    const { data: count, error: countError } = await auth.supabase.from("cash_counts").select("id").eq("id", countId).eq("status", "active").maybeSingle();
    if (countError) return cashCountUnavailableResponse();
    if (!count) return NextResponse.json({ error: "ไม่พบใบนับเงิน" }, { status: 404 });
    const position = Number(new URL(request.url).searchParams.get("position") ?? "1");
    if (!Number.isInteger(position) || position < 1 || position > 4) return NextResponse.json({ error: "ช่องไม่ถูกต้อง" }, { status: 400 });
    const { data, error } = await createSupabaseAdminClient().from("cash_count_bank_evidence")
      .select("drive_file_id").eq("count_id", countId).eq("account_position", position).maybeSingle();
    if (error) return cashCountUnavailableResponse();
    if (!data?.drive_file_id) return NextResponse.json({ error: "ไม่มีรูปบัญชี" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    try {
      const image = await downloadPrivateImageFromDrive(data.drive_file_id, request.signal);
      return new Response(image.body, { headers: { "Content-Type": image.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch { return NextResponse.json({ error: "โหลดรูปไม่สำเร็จ" }, { status: 503 }); }
  } catch {
    return cashCountUnavailableResponse();
  }
}
