import { NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import { parseSaleDetail } from "@/lib/income-expense/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "รหัสบิลขายไม่ถูกต้อง" }, { status: 400 });
  }

  const { data: bill, error: billError } = await result.supabase
    .from("income_expense")
    .select("id, location_id, bill_option, title, cost, server_bill_no, tx_date, created_by_name, revision_no, report_lock_no")
    .eq("id", id)
    .eq("record_status", "active")
    .maybeSingle();
  if (billError) {
    console.error("Income/Expense sale detail error:", billError);
    return NextResponse.json({ error: "โหลดรายละเอียดบิลขายไม่สำเร็จ" }, { status: 500 });
  }
  if (!bill || bill.bill_option !== "บิลขาย") {
    return NextResponse.json({ error: "ไม่พบบิลขาย" }, { status: 404 });
  }
  if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(bill.location_id)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }

  const { data: lines, error: lineError } = await result.supabase
    .from("income_expense_sale_lines")
    .select("id, income_sale_item_id, stock_product_id, title, quantity, unit_price, line_total, sequence_no")
    .eq("income_expense_id", id)
    .order("sequence_no");
  if (lineError) {
    console.error("Income/Expense sale lines error:", lineError);
    return NextResponse.json({ error: "โหลดรายละเอียดบิลขายไม่สำเร็จ" }, { status: 500 });
  }

  const detail = parseSaleDetail(bill, lines ?? []);
  if (!detail) {
    console.error("Income/Expense sale detail contract mismatch", { id });
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับรายละเอียดบิลขายตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }

  return NextResponse.json(detail, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
