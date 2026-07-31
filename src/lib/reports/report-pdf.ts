import type { ReportDetails } from "@/types/reports";
import {
  buildReportPresentation,
  formatMoney,
  formatQuantity,
  formatThaiDate,
  formatThaiDateTime,
  formatWholeMoney,
  reportPdfFilename,
  reportStatusLabel,
  rubberBillTotals,
  type RubberBillRow,
} from "@/lib/reports/report-presentation";
import {
  A4_LANDSCAPE,
  PDF_PALETTE,
  applyTextStyle,
  createSearchableA4PdfFile,
  drawActualText,
  drawPageFooters,
  drawRow,
  drawTable,
  ensureSpace,
  rowHeight,
  type PdfAlignment as Alignment,
  type PdfCell,
  type PdfDocument,
  type PdfState,
} from "@/lib/pdf/searchable-a4";

const PAGE_WIDTH = A4_LANDSCAPE.width;
const PAGE_LEFT = A4_LANDSCAPE.left;
const PAGE_TOP = A4_LANDSCAPE.top;
const TABLE_WIDTH = A4_LANDSCAPE.tableWidth;

const {
  darkGreen: DARK_GREEN,
  mint: MINT,
  paleGreen: PALE_GREEN,
  muted: MUTED,
  deleted: DELETED,
} = PDF_PALETTE;

function drawSectionTitle(state: PdfState, text: string) {
  ensureSpace(state, 54);
  const cell: PdfCell = { text, bold: true, fontSize: 13 };
  applyTextStyle(state.doc, cell);
  drawActualText(state.doc, text, PAGE_LEFT, state.y, {
    width: TABLE_WIDTH,
    height: 20,
  });
  state.y += 23;
}

function drawGroupTitle(state: PdfState, text: string) {
  ensureSpace(state, 48);
  const cell: PdfCell = { text, bold: true, fontSize: 13 };
  applyTextStyle(state.doc, cell);
  drawActualText(state.doc, text, PAGE_LEFT, state.y, {
    width: TABLE_WIDTH,
    height: 20,
  });
  state.y += 22;
}

function header(text: string, align: Alignment = "left"): PdfCell {
  return { text, align, bold: true, fontSize: 10, fill: MINT };
}

function data(text: string, align: Alignment = "left"): PdfCell {
  return { text, align, fontSize: 10 };
}

function total(
  text: string,
  align: Alignment = "left",
  colSpan = 1,
): PdfCell {
  return {
    text,
    align,
    colSpan,
    bold: true,
    fontSize: 13,
    fill: PALE_GREEN,
  };
}

function emptyRow(columns: number): PdfCell[] {
  return [{
    text: "ไม่มีรายการ",
    align: "center",
    color: MUTED,
    colSpan: columns,
  }];
}

function rubberRows(rows: RubberBillRow[]): PdfCell[][] {
  const result: PdfCell[][] = rows.length === 0
    ? [emptyRow(9)]
    : rows.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.customer),
      data(row.billType),
      data(formatQuantity(row.netWeight), "right"),
      data(formatMoney(row.averagePrice), "right"),
      data(formatMoney(row.rubberValue), "right"),
      data(formatMoney(row.deduction), "right"),
      data(formatWholeMoney(row.net), "right"),
    ]);
  const sums = rubberBillTotals(rows);
  result.push([
    total("รวม", "left", 4),
    total(formatQuantity(sums.weight), "right"),
    total(formatMoney(sums.weight > 0 ? sums.value / sums.weight : 0), "right"),
    total(formatMoney(sums.value), "right"),
    total(formatMoney(sums.deduction), "right"),
    total(formatWholeMoney(sums.net), "right"),
  ]);
  return result;
}

function drawReportHeader(state: PdfState, details: ReportDetails) {
  const { doc } = state;
  applyTextStyle(doc, { text: "", bold: true, fontSize: 18 });
  drawActualText(doc, "ชุดรายงาน LanFlow", PAGE_LEFT, state.y, {
    width: TABLE_WIDTH,
    height: 26,
  });
  state.y += 30;

  const metadata = [
    `เลขรายงาน: ${details.report.reportNo}`,
    `สาขา: ${details.report.locationName}`,
    `Cutoff: ${formatThaiDateTime(details.report.cutoffAt)}`,
    `ผู้สร้าง: ${details.report.createdByName}`,
    `สร้างเมื่อ: ${formatThaiDateTime(details.report.createdAt)}`,
    `จำนวน source: ${details.report.itemCount.toLocaleString("th-TH")}`,
    `สถานะ: ${reportStatusLabel(details.report)}`,
  ];
  const width = TABLE_WIDTH / 4;
  metadata.forEach((text, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const deletedStatus = index === 6 && details.report.status === "deleted";
    applyTextStyle(doc, {
      text,
      bold: deletedStatus,
      fontSize: 11,
      color: deletedStatus ? DELETED : DARK_GREEN,
    });
    drawActualText(doc, text, PAGE_LEFT + (column * width), state.y + (row * 20), {
      width: index === 6 ? width * 2 : width,
      height: 19,
    });
  });
  state.y += 44;
  doc
    .save()
    .moveTo(PAGE_LEFT, state.y)
    .lineTo(PAGE_WIDTH - PAGE_LEFT, state.y)
    .lineWidth(1.5)
    .strokeColor(DARK_GREEN)
    .stroke()
    .restore();
  state.y += 3;
}

function drawReportContent(doc: PdfDocument, details: ReportDetails) {
  const state: PdfState = { doc, y: PAGE_TOP };
  const presentation = buildReportPresentation(details);
  const { farmerRubberBills, incomeExpense, totals, traderRubberBills } = presentation;
  drawReportHeader(state, details);

  drawSectionTitle(state, "1. บิลยาง");
  const rubberHeader = [
    header("วันที่"),
    header("เลขที่"),
    header("ลูกค้า"),
    header("ประเภท"),
    header("น้ำหนักสุทธิ", "right"),
    header("ราคาเฉลี่ย", "right"),
    header("มูลค่ายาง", "right"),
    header("ยอดหักเงิน", "right"),
    header("ยอดที่ต้องจ่าย", "right"),
  ];
  const rubberWidths = [55, 80, 180, 60, 85, 80, 90, 75, 88];
  drawGroupTitle(state, "1.1 ผู้ค้าขาย");
  drawTable(state, rubberWidths, rubberHeader, rubberRows(traderRubberBills));
  drawGroupTitle(state, "1.2 ชาวสวน");
  drawTable(state, rubberWidths, rubberHeader, rubberRows(farmerRubberBills));

  drawSectionTitle(state, "2. อ่านใบชั่ง");
  const ocrRows: PdfCell[][] = details.ocrTickets.length === 0
    ? [emptyRow(10)]
    : details.ocrTickets.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.customer),
      data(row.licensePlate),
      data(formatQuantity(row.weightIn), "right"),
      data(formatQuantity(row.weightOut), "right"),
      data(formatQuantity(row.weightNet), "right"),
      data(formatQuantity(row.weightDeducted), "right"),
      data(formatQuantity(row.weightRemaining), "right"),
      data(formatMoney(row.amount), "right"),
    ]);
  ocrRows.push([
    total("รวม", "left", 6),
    total(formatQuantity(totals.ocrNet), "right"),
    total("", "right"),
    total(formatQuantity(totals.ocrRemaining), "right"),
    total(formatMoney(totals.ocrAmount), "right"),
  ]);
  drawTable(state, [50, 65, 150, 65, 65, 65, 60, 55, 65, 153], [
    header("วันที่"),
    header("เลขที่"),
    header("ลูกค้า"),
    header("ทะเบียน"),
    header("ชั่งเข้า", "right"),
    header("ชั่งออก", "right"),
    header("สุทธิ", "right"),
    header("หัก", "right"),
    header("คงเหลือ", "right"),
    header("ยอดเงิน", "right"),
  ], ocrRows);

  drawSectionTitle(state, "3. รับ-จ่ายรวม");
  const ledgerRows: PdfCell[][] = incomeExpense.length === 0
    ? [emptyRow(5)]
    : incomeExpense.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.title),
      data(row.income === null ? "" : formatMoney(row.income), "right"),
      data(row.expense === null ? "" : formatMoney(row.expense), "right"),
    ]);
  ledgerRows.push(
    [
      total("รวม", "left", 3),
      total(formatMoney(totals.income), "right"),
      total(formatMoney(totals.expense), "right"),
    ],
    [{
      text: `ยอดคงเหลือสุทธิ ${formatMoney(totals.balance)}`,
      align: "right",
      bold: true,
      fontSize: 15,
      fill: MINT,
      colSpan: 5,
    }],
  );
  drawTable(state, [70, 100, 323, 150, 150], [
    header("วันที่"),
    header("เลขที่"),
    header("รายการ"),
    header("รายรับ", "right"),
    header("รายจ่าย", "right"),
  ], ledgerRows);

  drawSectionTitle(state, "4. สต็อกสินค้า");
  const stockRows: PdfCell[][] = details.stock.length === 0
    ? [emptyRow(6)]
    : details.stock.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.product),
      data(row.type),
      data(formatQuantity(row.quantity), "right"),
      data(formatMoney(row.amount), "right"),
    ]);
  stockRows.push([
    total("รวมการเคลื่อนไหว", "left", 4),
    total(formatQuantity(totals.stockQuantity), "right"),
    total(formatMoney(totals.stockAmount), "right"),
  ]);
  drawTable(state, [70, 100, 220, 100, 140, 163], [
    header("วันที่"),
    header("เลขที่"),
    header("สินค้า"),
    header("ประเภท"),
    header("จำนวนเคลื่อนไหว", "right"),
    header("ยอดเงินประกอบ", "right"),
  ], stockRows);
  const stockBalance = details.stockBalances.length === 0
    ? "ไม่มีรายการ"
    : details.stockBalances
      .map((row) => `${row.product} ${formatQuantity(row.quantity)}`)
      .join("   ·   ");
  const balanceCell: PdfCell = {
    text: `ยอดคงเหลือ ณ cutoff: ${stockBalance}`,
    align: "right",
    bold: true,
    fontSize: 13,
    fill: MINT,
  };
  const balanceHeight = rowHeight(doc, [balanceCell], [TABLE_WIDTH]);
  ensureSpace(state, balanceHeight);
  drawRow(doc, [balanceCell], [TABLE_WIDTH], state.y, balanceHeight);
  state.y += balanceHeight + 8;

  drawSectionTitle(state, "5. เวลาและเงินเดือน");
  const payrollRows: PdfCell[][] = details.timePayroll.length === 0
    ? [emptyRow(7)]
    : details.timePayroll.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.category),
      data(row.employee),
      data(row.detail),
      data(row.quantity === null ? "-" : formatQuantity(row.quantity), "right"),
      data(row.amount === null ? "-" : formatMoney(row.amount), "right"),
    ]);
  payrollRows.push([total(
    `เวลาทำงาน ${formatQuantity(totals.workHours)} ชม.   ธุรกรรม/เงินเดือน ${formatMoney(totals.payrollAmount)}`,
    "right",
    7,
  )]);
  drawTable(state, [65, 85, 90, 100, 220, 100, 133], [
    header("วันที่"),
    header("เลขที่"),
    header("ประเภท"),
    header("พนักงาน"),
    header("รายละเอียด"),
    header("ชั่วโมง/วัน", "right"),
    header("จำนวนเงิน", "right"),
  ], payrollRows);

  drawSectionTitle(state, "6. โอนเงิน (ธนาคารเท่านั้น)");
  const transferRows: PdfCell[][] = details.bankTransfers.length === 0
    ? [emptyRow(9)]
    : details.bankTransfers.map((row) => [
      data(formatThaiDate(row.date)),
      data(row.number),
      data(row.direction === "out" ? "ออก" : "เข้า"),
      data(row.party),
      data(row.status),
      data(formatMoney(row.amount), "right"),
      data(formatMoney(row.slipAmount), "right"),
      data(formatMoney(row.fee), "right"),
      data(formatMoney(row.branchPaid), "right"),
    ]);
  transferRows.push([
    total("รวม", "left", 5),
    total(formatMoney(totals.transferAmount), "right"),
    total(formatMoney(totals.slipAmount), "right"),
    total(formatMoney(totals.fee), "right"),
    total(formatMoney(totals.branchPaid), "right"),
  ]);
  drawTable(state, [60, 75, 55, 150, 80, 100, 95, 78, 100], [
    header("วันที่"),
    header("เลขที่"),
    header("ทิศทาง"),
    header("คู่รายการ"),
    header("สถานะ"),
    header("ยอดที่ต้องจ่าย", "right"),
    header("ยอดสลิป", "right"),
    header("ค่าธรรมเนียม", "right"),
    header("สาขาจ่าย", "right"),
  ], transferRows);
}

export async function createReportPdfFile(details: ReportDetails, signal: AbortSignal) {
  return createSearchableA4PdfFile({
    filename: reportPdfFilename(details.report),
    title: `รายงาน LanFlow ${details.report.reportNo}`,
    subject: `ชุดรายงาน ${details.report.locationName}`,
    signal,
    render(doc) {
      drawReportContent(doc, details);
      drawPageFooters(doc, details.report.reportNo);
    },
  });
}
