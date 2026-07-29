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

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_LEFT = 24;
const PAGE_TOP = 24;
const PAGE_BOTTOM = PAGE_HEIGHT - 34;
const TABLE_WIDTH = PAGE_WIDTH - (PAGE_LEFT * 2);
const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 3;

const DARK_GREEN = "#173B2A";
const MINT = "#DDEFE3";
const PALE_GREEN = "#EFF6F1";
const BORDER = "#718078";
const MUTED = "#53645A";
const DELETED = "#A12626";
const WHITE = "#FFFFFF";

type PdfDocument = PDFKit.PDFDocument;
type Alignment = "left" | "right" | "center";

type PdfCell = {
  text: string;
  align?: Alignment;
  bold?: boolean;
  fontSize?: number;
  fill?: string;
  color?: string;
  colSpan?: number;
};

type PdfState = {
  doc: PdfDocument;
  y: number;
};

function fontName(bold = false) {
  return bold ? "NotoSansThaiBold" : "NotoSansThai";
}

function applyTextStyle(doc: PdfDocument, cell: PdfCell) {
  doc
    .font(fontName(cell.bold))
    .fontSize(cell.fontSize ?? 10)
    .fillColor(cell.color ?? DARK_GREEN);
}

function drawActualText(
  doc: PdfDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions,
) {
  doc.markContent("Span", { actual: text, lang: "th-TH" });
  doc.text(text, x, y, options);
  doc.endMarkedContent();
}

function cellWidth(widths: number[], index: number, span: number) {
  return widths.slice(index, index + span).reduce((sum, width) => sum + width, 0);
}

function rowHeight(doc: PdfDocument, row: PdfCell[], widths: number[]) {
  let column = 0;
  let height = 0;
  for (const cell of row) {
    const span = cell.colSpan ?? 1;
    const width = cellWidth(widths, column, span) - (CELL_PADDING_X * 2);
    applyTextStyle(doc, cell);
    height = Math.max(
      height,
      doc.heightOfString(cell.text || " ", {
        width,
        lineGap: 0,
        align: cell.align ?? "left",
      }) + (CELL_PADDING_Y * 2),
    );
    column += span;
  }
  return Math.max(height, 22);
}

function drawRow(
  doc: PdfDocument,
  row: PdfCell[],
  widths: number[],
  y: number,
  height: number,
) {
  let x = PAGE_LEFT;
  let column = 0;
  for (const cell of row) {
    const span = cell.colSpan ?? 1;
    const width = cellWidth(widths, column, span);
    doc
      .save()
      .rect(x, y, width, height)
      .fillAndStroke(cell.fill ?? WHITE, BORDER)
      .restore();
    applyTextStyle(doc, cell);
    drawActualText(doc, cell.text, x + CELL_PADDING_X, y + CELL_PADDING_Y, {
      width: width - (CELL_PADDING_X * 2),
      height: height - (CELL_PADDING_Y * 2),
      lineGap: 0,
      align: cell.align ?? "left",
    });
    x += width;
    column += span;
  }
}

function addPage(state: PdfState) {
  state.doc.addPage({ size: "A4", layout: "landscape", margins: {
    top: PAGE_TOP,
    left: PAGE_LEFT,
    right: PAGE_LEFT,
    bottom: 34,
  } });
  state.y = PAGE_TOP;
}

function ensureSpace(state: PdfState, height: number) {
  if (state.y + height <= PAGE_BOTTOM) return;
  addPage(state);
}

function drawTable(
  state: PdfState,
  widths: number[],
  header: PdfCell[],
  rows: PdfCell[][],
) {
  const headerHeight = rowHeight(state.doc, header, widths);
  const firstRowHeight = rows.length > 0 ? rowHeight(state.doc, rows[0], widths) : 22;
  if (state.y + headerHeight + firstRowHeight > PAGE_BOTTOM) addPage(state);

  const drawHeader = () => {
    drawRow(state.doc, header, widths, state.y, headerHeight);
    state.y += headerHeight;
  };
  drawHeader();

  for (const row of rows) {
    const height = rowHeight(state.doc, row, widths);
    if (state.y + height > PAGE_BOTTOM) {
      addPage(state);
      drawHeader();
    }
    drawRow(state.doc, row, widths, state.y, height);
    state.y += height;
  }
  state.y += 8;
}

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
    `เวลาทำงาน ${formatQuantity(totals.workHours)} ชม.   วันลา ${formatQuantity(totals.leaveDays)} วัน   ธุรกรรม/เงินเดือน ${formatMoney(totals.payrollAmount)}`,
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

function drawFooters(doc: PdfDocument, reportNo: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const text = `${reportNo} · หน้า ${index + 1}/${range.count}`;
    applyTextStyle(doc, { text, fontSize: 9, color: MUTED });
    drawActualText(doc, text, PAGE_LEFT, PAGE_HEIGHT - 24, {
      width: TABLE_WIDTH,
      height: 14,
      align: "right",
      lineBreak: false,
    });
  }
}

async function loadFontBuffers(signal: AbortSignal) {
  const [regularResponse, boldResponse] = await Promise.all([
    fetch("/fonts/NotoSansThai-Regular.ttf", { signal, cache: "force-cache" }),
    fetch("/fonts/NotoSansThai-Bold.ttf", { signal, cache: "force-cache" }),
  ]);
  if (!regularResponse.ok || !boldResponse.ok) {
    throw new Error("โหลดฟอนต์ภาษาไทยสำหรับ PDF ไม่สำเร็จ");
  }
  const [regular, bold] = await Promise.all([
    regularResponse.arrayBuffer(),
    boldResponse.arrayBuffer(),
  ]);
  return {
    regular: new Uint8Array(regular),
    bold: new Uint8Array(bold),
  };
}

function abortError() {
  return new DOMException("ยกเลิกการสร้าง PDF", "AbortError");
}

export async function createReportPdfFile(details: ReportDetails, signal: AbortSignal) {
  signal.throwIfAborted();
  const [{ default: PDFDocument }, fonts] = await Promise.all([
    import("pdfkit/js/pdfkit.standalone"),
    loadFontBuffers(signal),
  ]);
  signal.throwIfAborted();

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    bufferPages: true,
    compress: true,
    tagged: true,
    lang: "th-TH",
    info: {
      Title: `รายงาน LanFlow ${details.report.reportNo}`,
      Subject: `ชุดรายงาน ${details.report.locationName}`,
      Author: "LanFlow",
    },
    margins: {
      top: PAGE_TOP,
      left: PAGE_LEFT,
      right: PAGE_LEFT,
      bottom: 34,
    },
  });
  doc.registerFont("NotoSansThai", fonts.regular as unknown as Buffer);
  doc.registerFont("NotoSansThaiBold", fonts.bold as unknown as Buffer);

  const chunks: Uint8Array[] = [];
  const blob = await new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      settled = true;
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("error", (error: Error) => {
      signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(error);
    });
    doc.on("end", () => {
      signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      const parts = chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer);
      resolve(new Blob(parts, { type: "application/pdf" }));
    });

    try {
      drawReportContent(doc, details);
      drawFooters(doc, details.report.reportNo);
      doc.end();
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      settled = true;
      reject(error);
    }
  });
  signal.throwIfAborted();

  return new File([blob], reportPdfFilename(details.report), {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}
