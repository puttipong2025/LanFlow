import { applyTextStyle, createSearchableRollPdfFile, drawActualText, type PdfDocument } from "@/lib/pdf/searchable-a4";
import { CASH_DENOMINATIONS, type CashCountDetail } from "@/types/cash-counts";

const money = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
export function cashCountDifference(value: number | null) {
  return value == null ? "ไม่มีข้อมูลฐานเดิม" : value === 0 ? "ยอดตรงกัน 0.00 บาท" : `เงิน${value < 0 ? "ขาด" : "เกิน"} ${money(Math.abs(value))} บาท`;
}
export function renderCashCountPdf(doc: PdfDocument, detail: CashCountDetail) {
  const width = 80 * 72 / 25.4 - 20;
  let y = 12;
  function line(value: string, bold = false, align: "left" | "center" | "right" = "left") {
    applyTextStyle(doc, { text: value, bold, fontSize: bold ? 10 : 9, color: "#000000" });
    const height = doc.heightOfString(value || " ", { width, align });
    drawActualText(doc, value, 10, y, { width, align }); y += height + 5;
  }
  line("ใบนับเงิน", true, "center");
  line(detail.locationName, true, "center");
  line(detail.reportNo); line(`เริ่มนับ: ${date(detail.cutoffAt)}`); line(`บันทึก: ${date(detail.createdAt)}`);
  line("รายละเอียดเงินสด", true);
  for (const denomination of CASH_DENOMINATIONS) {
    const count = detail.actualCounts[String(denomination)] ?? 0;
    line(`${money(denomination)} × ${count} = ${money(denomination * count)}`);
  }
  line(`รวมเงินสด ${money(detail.actualTotal)} บาท`, true);
  for (const account of detail.bankAccounts ?? []) line(`บัญชี${account.position} = ${money(account.amount)} บาท`);
  line(detail.hasBankAccount ? `รวมเงินในบัญชี ${money(detail.accountBalance)} บาท` : "เงินในบัญชี: ไม่รวมในการนับ");
  line(`รวมยอดนับ ${money(detail.countedTotal)} บาท`, true);
  line(`ยอดระบบ ณ เริ่มนับ ${detail.systemBalance == null ? "ไม่มีข้อมูล" : money(detail.systemBalance)}`);
  line(cashCountDifference(detail.systemBalance == null ? null : detail.differenceTotal), true, "center");
  y += 22; line("ลงชื่อ ........................................", false, "center");
  line(`(${detail.createdByName})`, false, "center"); line("ผู้นับ", false, "center");
  y += 22; line("ลงชื่อ ........................................", false, "center");
  line(detail.checkedByName ? `(${detail.checkedByName})` : "(........................................)", false, "center");
  line("ผู้ตรวจ", false, "center");
  return y;
}
export function createCashCountPdf(detail: CashCountDetail, signal: AbortSignal) {
  return createSearchableRollPdfFile({ filename: `${detail.reportNo}-80mm.pdf`, title: "ใบนับเงิน", subject: "ใบนับเงิน 80 มม.",
    signal, width: 80 * 72 / 25.4, margins: { top: 10, bottom: 10, left: 10, right: 10 },
    render: (doc) => renderCashCountPdf(doc, detail) });
}
