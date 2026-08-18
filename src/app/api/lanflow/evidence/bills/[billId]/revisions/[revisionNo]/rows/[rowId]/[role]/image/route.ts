import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import { downloadEvidenceImageFromDrive } from "@/lib/server/google-drive";
import { canAccessEvidenceLocation, isWeightEvidenceBackupRole, UUID_PATTERN } from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ billId: string; revisionNo: string; rowId: string; role: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { billId, revisionNo: rawRevisionNo, rowId, role } = await context.params;
  const revisionNo = Number(rawRevisionNo);
  if (
    !UUID_PATTERN.test(billId)
    || !UUID_PATTERN.test(rowId)
    || !Number.isInteger(revisionNo)
    || revisionNo < 0
    || !isWeightEvidenceBackupRole(role)
  ) {
    return NextResponse.json({ error: "ข้อมูลรูปไม่ถูกต้อง" }, { status: 400 });
  }

  const { data: bill, error: billError } = await authResult.supabase
    .from("rubber_bills")
    .select("location_id, revision_no, record_status")
    .eq("id", billId)
    .maybeSingle();
  if (billError) return NextResponse.json({ error: "ตรวจสอบบิลไม่สำเร็จ" }, { status: 503 });
  if (!bill || bill.record_status !== "active") return NextResponse.json({ error: "ไม่พบบิล" }, { status: 404 });
  if (!canAccessEvidenceLocation(authResult.auth, bill.location_id)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขานี้" }, { status: 403 });
  }
  if (Number(bill.revision_no) !== revisionNo) {
    return NextResponse.json({ error: "บิลถูกแก้ไขแล้ว" }, { status: 409 });
  }

  const { data: item } = await authResult.supabase
    .from("rubber_bill_items")
    .select("id")
    .eq("id", rowId)
    .eq("bill_id", billId)
    .eq("item_type", "weigh")
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "ไม่พบรายการชั่ง" }, { status: 404 });

  const { data: file, error: fileError } = await authResult.supabase
    .from("rubber_bill_item_evidence_files")
    .select("drive_file_id")
    .eq("bill_item_id", rowId)
    .eq("revision_no", revisionNo)
    .eq("role", role)
    .maybeSingle();
  if (fileError) return NextResponse.json({ error: "ตรวจสอบรูปไม่สำเร็จ" }, { status: 503 });
  if (!file) return NextResponse.json({ error: "ไม่มีรูปหลักฐาน" }, { status: 404 });

  try {
    const driveResponse = await downloadEvidenceImageFromDrive(file.drive_file_id, request.signal);
    return new Response(driveResponse.body, {
      status: 200,
      headers: {
        "Content-Type": driveResponse.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "เปิดรูปจาก Google Drive ไม่สำเร็จ" }, { status: 503 });
  }
}
