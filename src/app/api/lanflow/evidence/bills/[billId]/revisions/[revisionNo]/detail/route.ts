import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import { canAccessEvidenceLocation, UUID_PATTERN } from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ billId: string; revisionNo: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const { billId, revisionNo: rawRevisionNo } = await context.params;
  const revisionNo = Number(rawRevisionNo);
  if (!UUID_PATTERN.test(billId) || !Number.isInteger(revisionNo) || revisionNo < 0) {
    return NextResponse.json({ error: "ข้อมูลบิลไม่ถูกต้อง" }, { status: 400 });
  }

  const { data: bill, error: billError } = await authResult.supabase
    .from("rubber_bills")
    .select("id, location_id, revision_no, record_status, bill_no, local_bill_no, server_bill_no, customer_name, client_created_at, created_at, evidence_manual_correction_count")
    .eq("id", billId)
    .maybeSingle();
  if (billError) return NextResponse.json({ error: "อ่านข้อมูลบิลไม่สำเร็จ" }, { status: 503 });
  if (!bill || bill.record_status !== "active") {
    return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 });
  }
  if (!canAccessEvidenceLocation(authResult.auth, bill.location_id)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" }, { status: 403 });
  }
  if (Number(bill.revision_no) !== revisionNo) {
    return NextResponse.json({ error: "บิลถูกแก้ไขแล้ว กรุณาโหลดรายการใหม่" }, { status: 409 });
  }

  const { data: rows, error: rowsError } = await authResult.supabase
    .from("rubber_bill_items")
    .select("id, sequence_no, description, weight_in, weight_out, net_weight")
    .eq("bill_id", billId)
    .eq("item_type", "weigh")
    .order("sequence_no");
  if (rowsError) return NextResponse.json({ error: "อ่านรายการชั่งไม่สำเร็จ" }, { status: 503 });

  const rowIds = (rows ?? []).map((row) => row.id);
  const { data: files, error: filesError } = rowIds.length
    ? await authResult.supabase
        .from("rubber_bill_item_evidence_files")
        .select("bill_item_id, role")
        .in("bill_item_id", rowIds)
        .eq("revision_no", revisionNo)
    : { data: [], error: null };
  if (filesError) return NextResponse.json({ error: "อ่านรูปหลักฐานไม่สำเร็จ" }, { status: 503 });

  const rolesByRow = new Map<string, Set<string>>();
  for (const file of files ?? []) {
    const roles = rolesByRow.get(file.bill_item_id) ?? new Set<string>();
    roles.add(file.role);
    rolesByRow.set(file.bill_item_id, roles);
  }

  const imageUrl = (rowId: string, role: string) =>
    `/api/lanflow/evidence/bills/${billId}/revisions/${revisionNo}/rows/${rowId}/${role}/image`;

  return NextResponse.json({
    bill: {
      id: bill.id,
      revisionNo,
      billNo: bill.server_bill_no ?? bill.bill_no ?? bill.local_bill_no,
      customerName: bill.customer_name,
      clientCreatedAt: bill.client_created_at ?? bill.created_at,
      manualCorrectionCount: Number(bill.evidence_manual_correction_count ?? 0),
    },
    rows: (rows ?? []).map((row) => {
      const roles = rolesByRow.get(row.id) ?? new Set<string>();
      return {
        id: row.id,
        sequenceNo: Number(row.sequence_no),
        label: row.description ?? `รายการชั่ง ${row.sequence_no}`,
        inWeight: Number(row.weight_in ?? 0),
        outWeight: Number(row.weight_out ?? 0),
        netWeight: Number(row.net_weight ?? 0),
        rubberImageUrl: roles.has("rubber") ? imageUrl(row.id, "rubber") : null,
        displayInImageUrl: roles.has("displayIn") ? imageUrl(row.id, "displayIn") : null,
        displayOutImageUrl: roles.has("displayOut") ? imageUrl(row.id, "displayOut") : null,
      };
    }),
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}
