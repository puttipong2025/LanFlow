import { NextResponse } from "next/server";

const REPORT_ERROR_GROUPS = [
  {
    label: "บิลยาง",
    keywords: ["rubber_bill", "rubber bill", "บิลยาง"],
  },
  {
    label: "อ่านใบชั่ง",
    keywords: ["ocr_ticket", "ocr ticket", "ใบชั่ง"],
  },
  {
    label: "รับ–จ่าย",
    keywords: ["income_expense", "income expense", "rubber_export", "rubber export", "รับ-จ่าย", "รับ–จ่าย"],
  },
  {
    label: "สต็อกสินค้า",
    keywords: ["stock_entries", "stock_entry", "acid_stock", "stock_product", "สต็อก"],
  },
  {
    label: "เวลาและเงินเดือน",
    keywords: ["time_segment", "financial_transaction", "payroll_slip", "เงินเดือน"],
  },
  {
    label: "โอนเงิน",
    keywords: ["money_transfer", "bank_transfer", "cash_transfer", "โอนเงิน"],
  },
] as const;

export function reportErrorGroups(message: string): string[] {
  const normalized = message.toLowerCase();
  const groups = REPORT_ERROR_GROUPS
    .filter(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(({ label }) => label);

  return groups.length > 0 ? groups : ["ระบบรายงาน"];
}

export function reportErrorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("access denied")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (message.includes("ไม่พบ")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    message.includes("ไม่มีรายการ") ||
    message.includes("ล่าสุด") ||
    message.includes("REPORT_LOCKED") ||
    message.includes("RUBBER_BILL_PENDING") ||
    message.includes("RUBBER_EXPORT_LOCKED") ||
    message.includes("CASH_COUNT_ACTIVE") ||
    message.includes("CASH_COUNT_LINKED") ||
    message.includes("active")
  ) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export function reportCreateErrorResponse(message: string) {
  if (
    message.includes("ไม่มีสิทธิ์")
    || message.includes("access denied")
    || message.includes("ไม่มีรายการ")
    || message.includes("CASH_COUNT_ACTIVE")
  ) {
    return reportErrorResponse(message);
  }

  const status = reportErrorResponse(message).status;
  return NextResponse.json({
    error: "สร้างรายงานไม่สำเร็จ",
    errorGroups: reportErrorGroups(message),
  }, { status });
}
