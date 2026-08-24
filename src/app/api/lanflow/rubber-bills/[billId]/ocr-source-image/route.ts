import { downloadPrivateImageFromDrive } from "@/lib/server/google-drive";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import { rubberBillOcrError, RUBBER_BILL_OCR_UUID_PATTERN } from "@/lib/server/rubber-bill-ocr";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ billId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) {
    const status = authResult.response.status;
    return rubberBillOcrError(
      status,
      status === 401 ? "UNAUTHORIZED" : "AUTH_UNAVAILABLE",
      status === 401 ? "กรุณาเข้าสู่ระบบ" : "ตรวจสอบสิทธิ์ไม่สำเร็จ",
      status === 503,
    );
  }

  const { billId } = await context.params;
  if (!RUBBER_BILL_OCR_UUID_PATTERN.test(billId)) {
    return rubberBillOcrError(400, "BILL_ID_INVALID", "ข้อมูลบิลไม่ถูกต้อง");
  }
  const { data: bill, error: billError } = await authResult.supabase
    .from("rubber_bills")
    .select("id, location_id, input_method, has_ocr_source_image, record_status")
    .eq("id", billId)
    .maybeSingle();
  if (billError) {
    return rubberBillOcrError(503, "BILL_READ_FAILED", "ตรวจสอบบิลไม่สำเร็จ", true);
  }
  if (!bill || bill.record_status !== "active" || bill.input_method !== "ocr" || !bill.has_ocr_source_image) {
    return rubberBillOcrError(404, "OCR_IMAGE_NOT_FOUND", "ไม่พบรูปใบชั่งของบิลนี้");
  }
  if (!hasSystemManagerAccess(authResult.auth) && !authResult.auth.locationIds.includes(bill.location_id)) {
    return rubberBillOcrError(403, "LOCATION_ACCESS_DENIED", "ไม่มีสิทธิ์เข้าถึงสาขานี้");
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return rubberBillOcrError(503, "OCR_IMAGE_STORAGE_UNAVAILABLE", "ระบบจัดเก็บรูปไม่พร้อมใช้งาน", true);
  }
  const { data: privateBill, error: privateBillError } = await admin
    .from("rubber_bills")
    .select("ocr_source_id")
    .eq("id", billId)
    .eq("location_id", bill.location_id)
    .maybeSingle();
  if (privateBillError) {
    return rubberBillOcrError(503, "OCR_IMAGE_READ_FAILED", "ตรวจสอบรูปใบชั่งไม่สำเร็จ", true);
  }
  if (!privateBill?.ocr_source_id) {
    return rubberBillOcrError(404, "OCR_IMAGE_NOT_FOUND", "ไม่พบรูปใบชั่งของบิลนี้");
  }
  const { data: source, error: sourceError } = await admin
    .from("rubber_bill_ocr_sources")
    .select("drive_file_id, image_mime_type")
    .eq("id", privateBill.ocr_source_id)
    .eq("location_id", bill.location_id)
    .eq("state", "attached")
    .maybeSingle();
  if (sourceError) {
    return rubberBillOcrError(503, "OCR_IMAGE_READ_FAILED", "ตรวจสอบรูปใบชั่งไม่สำเร็จ", true);
  }
  if (!source) {
    return rubberBillOcrError(404, "OCR_IMAGE_NOT_FOUND", "ไม่พบรูปใบชั่งของบิลนี้");
  }

  try {
    const driveResponse = await downloadPrivateImageFromDrive(source.drive_file_id, request.signal);
    return new Response(driveResponse.body, {
      status: 200,
      headers: {
        "Content-Type": source.image_mime_type,
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return rubberBillOcrError(503, "OCR_IMAGE_DOWNLOAD_FAILED", "เปิดรูปใบชั่งไม่สำเร็จ", true);
  }
}
