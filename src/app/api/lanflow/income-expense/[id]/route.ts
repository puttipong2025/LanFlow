import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";

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
  if (billError) return NextResponse.json({ error: billError.message }, { status: 500 });
  if (!bill || bill.bill_option !== "บิลขาย") {
    return NextResponse.json({ error: "ไม่พบบิลขาย" }, { status: 404 });
  }
  if (!result.auth.locationIds.includes(bill.location_id)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }

  const { data: lines, error: lineError } = await result.supabase
    .from("income_expense_sale_lines")
    .select("id, income_sale_item_id, stock_product_id, title, quantity, unit_price, line_total, sequence_no")
    .eq("income_expense_id", id)
    .order("sequence_no");
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });

  return NextResponse.json({
    title: bill.title,
    cost: Number(bill.cost),
    serverBillNo: bill.server_bill_no,
    txDate: bill.tx_date,
    createdByName: bill.created_by_name,
    revisionNo: bill.revision_no,
    reportLockNo: bill.report_lock_no,
    saleLineCount: lines?.length ?? 0,
    saleLines: (lines ?? []).map((line) => ({
      id: line.id,
      incomeSaleItemId: line.income_sale_item_id,
      stockProductId: line.stock_product_id,
      title: line.title,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      lineTotal: Number(line.line_total),
      sequenceNo: line.sequence_no,
    })),
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
