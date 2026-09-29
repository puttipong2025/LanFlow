import { NextResponse } from "next/server";

const PUBLIC_BUSINESS_ERROR_PREFIXES = [
  "REPORT_LOCKED:",
  "ไม่มีสิทธิ์",
  "เฉพาะ",
  "ผู้สร้างหรือ super_admin",
  "สาขาปลายทางต้องต่างจากสาขาต้นทาง",
  "ไม่พบ",
  "แก้ไขได้ก่อนตรวจรับเงินเท่านั้น",
  "รายการนี้",
  "คำขอนี้",
];

export function cashTransferErrorResponse(message: string) {
  if (!PUBLIC_BUSINESS_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    console.error("Cash branch transfer RPC error:", message);
    return NextResponse.json(
      { error: "ดำเนินการรายการเงินสดไม่สำเร็จ" },
      { status: 500 },
    );
  }

  const status =
    /ไม่มีสิทธิ์|เฉพาะผู้|เฉพาะ super_admin|ผู้สร้างหรือ super_admin/.test(message) ? 403
      : /ไม่พบ/.test(message) ? 404
        : /REPORT_LOCKED|ถูกตรวจรับแล้ว|ก่อนตรวจรับ|ถูกดำเนินการแล้ว/i.test(message) ? 409
          : 400;

  return NextResponse.json({ error: message }, { status });
}
