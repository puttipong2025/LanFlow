import { NextResponse } from "next/server";

export function cashTransferErrorResponse(message: string) {
  const status =
    /ไม่มีสิทธิ์|เฉพาะ super_admin|ผู้สร้างหรือ super_admin/.test(message) ? 403
      : /ไม่พบ/.test(message) ? 404
        : /ถูกตรวจรับแล้ว|ก่อนตรวจรับ|ไม่อยู่ในสถานะ|duplicate key|already exists/i.test(message) ? 409
          : 400;

  return NextResponse.json({ error: message }, { status });
}
