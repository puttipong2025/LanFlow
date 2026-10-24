import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { bankImage, readBankBalance } from "@/lib/server/cash-count-bank-ocr";
import { isUuid } from "@/lib/server/management-route-error";
import { CashCountInputError, cashCountUnavailableResponse } from "@/lib/server/cash-count-response";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const form = await request.formData();
    const sessionId = form.get("sessionId");
    const slotId = form.get("slotId");
    if (!isUuid(slotId)) throw new CashCountInputError("ช่องบัญชีไม่ถูกต้อง");
    if (!isUuid(sessionId)) throw new CashCountInputError("รอบนับไม่ถูกต้อง");
    const admin = createSupabaseAdminClient();
    const { data: session, error } = await admin.from("cash_count_sessions").select("*")
      .eq("id", sessionId).eq("started_by_user_id", auth.auth.sub).single();
    if (error || !session || session.status !== "active" || Date.parse(session.expires_at) <= Date.now()) throw new CashCountInputError("รอบนับหมดเวลา กรุณาเริ่มใหม่");
    const { buffer, type, hash } = await bankImage(form.get("image"));
    const { data: previous, error: previousError } = await admin.from("cash_count_bank_evidence")
      .select("id,amount").eq("session_id", sessionId).eq("owner_user_id", auth.auth.sub).eq("slot_id", slotId).eq("image_sha256", hash).maybeSingle();
    if (previousError) throw new CashCountInputError("ตรวจสอบรูปซ้ำไม่สำเร็จ");
    if (previous) return NextResponse.json({ evidenceId: previous.id, amount: Number(previous.amount) }, { headers: { "Cache-Control": "no-store" } });
    // Repeated photo is allowed in a different slot, but does not require another AI call.
    const { data: cached, error: cachedError } = await admin.from("cash_count_bank_evidence")
      .select("amount,balance_kind").eq("session_id", sessionId).eq("owner_user_id", auth.auth.sub)
      .eq("image_sha256", hash).limit(1).maybeSingle();
    if (cachedError) throw new CashCountInputError("ตรวจสอบผลอ่านรูปไม่สำเร็จ");
    const result = cached ? { amount: String(cached.amount), kind: cached.balance_kind } : await readBankBalance(buffer, type.mimeType);
    const { error: insertError } = await admin.from("cash_count_bank_evidence")
      .upsert({ session_id: sessionId, slot_id: slotId, owner_user_id: auth.auth.sub, image_sha256: hash,
        amount: result.amount, balance_kind: result.kind }, { onConflict: "session_id,slot_id,image_sha256", ignoreDuplicates: true });
    if (insertError) throw new CashCountInputError("บันทึกผล OCR ไม่สำเร็จ");
    const { data: saved, error: readError } = await admin.from("cash_count_bank_evidence").select("id,amount")
      .eq("session_id", sessionId).eq("slot_id", slotId).eq("image_sha256", hash).single();
    if (readError || !saved) throw new CashCountInputError("อ่านผล OCR ไม่สำเร็จ");
    return NextResponse.json({ evidenceId: saved.id, amount: Number(saved.amount) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CashCountInputError) return NextResponse.json({ error: error.message }, {
      status: 422, headers: { "Cache-Control": "private, no-store" },
    });
    return cashCountUnavailableResponse();
  }
}
