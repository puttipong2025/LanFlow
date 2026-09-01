import {
  PDF_PALETTE,
  applyTextStyle,
  createSearchableRollPdfFile,
  drawActualText,
  type PdfDocument,
} from "@/lib/pdf/searchable-a4";
import {
  buildSlipDocumentDetailRows,
  type SlipDocumentRow,
  type TimePayrollSlipDocument,
} from "@/lib/time-tracking/slip-document";

const MM_TO_POINTS = 72 / 25.4;
const RECEIPT_WIDTH = 80 * MM_TO_POINTS;
const RECEIPT_MARGIN = 9;
const CONTENT_WIDTH = RECEIPT_WIDTH - (RECEIPT_MARGIN * 2);
const moneyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });

type ReceiptState = {
  doc: PdfDocument;
  document: TimePayrollSlipDocument;
  y: number;
};

type TextOptions = {
  bold?: boolean;
  size?: number;
  color?: string;
  align?: "left" | "right" | "center";
  lineGap?: number;
};

function textHeight(doc: PdfDocument, value: string, width: number, options: TextOptions = {}) {
  applyTextStyle(doc, {
    text: value,
    bold: options.bold,
    fontSize: options.size,
    color: options.color,
  });
  return doc.heightOfString(value || " ", {
    width,
    align: options.align ?? "left",
    lineGap: options.lineGap ?? 1,
  });
}

function text(
  doc: PdfDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  options: TextOptions = {},
) {
  applyTextStyle(doc, {
    text: value,
    bold: options.bold,
    fontSize: options.size,
    color: options.color,
  });
  drawActualText(doc, value, x, y, {
    width,
    align: options.align ?? "left",
    lineGap: options.lineGap ?? 1,
  });
}

function divider(state: ReceiptState, gap = 7) {
  state.doc
    .moveTo(RECEIPT_MARGIN, state.y)
    .lineTo(RECEIPT_MARGIN + CONTENT_WIDTH, state.y)
    .strokeColor("#C9D4CD")
    .lineWidth(0.6)
    .stroke();
  state.y += gap;
}

function sectionTitle(state: ReceiptState, title: string) {
  const height = textHeight(state.doc, title, CONTENT_WIDTH - 12, { bold: true, size: 9 }) + 10;
  state.doc.save().roundedRect(RECEIPT_MARGIN, state.y, CONTENT_WIDTH, height, 2).fill(PDF_PALETTE.paleGreen).restore();
  text(state.doc, title, RECEIPT_MARGIN + 6, state.y + 5, CONTENT_WIDTH - 12, {
    bold: true,
    size: 9,
  });
  state.y += height + 5;
}

function keyValueRows(state: ReceiptState, rows: Array<{ label: string; value: string }>) {
  const labelWidth = 72;
  const valueWidth = CONTENT_WIDTH - labelWidth - 10;
  for (const row of rows) {
    const labelHeight = textHeight(state.doc, row.label, labelWidth, { size: 7.7 });
    const valueHeight = textHeight(state.doc, row.value, valueWidth, {
      bold: true,
      size: 7.7,
      align: "right",
    });
    const rowHeight = Math.max(18, Math.max(labelHeight, valueHeight) + 7);
    text(state.doc, row.label, RECEIPT_MARGIN + 3, state.y + 3, labelWidth, {
      color: PDF_PALETTE.muted,
      size: 7.7,
    });
    text(state.doc, row.value, RECEIPT_MARGIN + labelWidth + 7, state.y + 3, valueWidth, {
      bold: true,
      size: 7.7,
      align: "right",
    });
    state.y += rowHeight;
    divider(state, 4);
  }
  state.y += 1;
}

function drawCalendar(state: ReceiptState) {
  sectionTitle(state, `ตารางการทำงาน เดือน ${state.document.month}`);
  const columnWidth = CONTENT_WIDTH / 7;
  const weekdays = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  weekdays.forEach((weekday, index) => {
    text(state.doc, weekday, RECEIPT_MARGIN + (index * columnWidth), state.y + 2, columnWidth, {
      bold: true,
      size: 6.2,
      align: "center",
    });
  });
  state.y += 14;

  const firstWeekday = new Date(`${state.document.month}-01T00:00:00+07:00`).getDay();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...state.document.calendar,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  for (let offset = 0; offset < cells.length; offset += 7) {
    cells.slice(offset, offset + 7).forEach((day, index) => {
      const x = RECEIPT_MARGIN + (index * columnWidth);
      const fill = !day
        ? PDF_PALETTE.white
        : day.paidDays >= 1
          ? PDF_PALETTE.darkGreen
          : day.paidDays > 0
            ? PDF_PALETTE.mint
            : PDF_PALETTE.white;
      const color = day?.paidDays && day.paidDays >= 1 ? PDF_PALETTE.white : PDF_PALETTE.darkGreen;
      state.doc.save().rect(x, state.y, columnWidth, 24).fillAndStroke(fill, "#C9D4CD").restore();
      if (day) {
        const label = day.paidDays > 0 && day.paidDays < 1
          ? `${day.day}\n${moneyFormatter.format(day.paidDays)}`
          : String(day.day);
        text(state.doc, label, x + 1, state.y + 4, columnWidth - 2, {
          bold: true,
          size: day.paidDays > 0 && day.paidDays < 1 ? 5.4 : 6.7,
          color,
          align: "center",
          lineGap: 0,
        });
      }
    });
    state.y += 24;
  }
  state.y += 7;
}

function drawTransactionRows(state: ReceiptState, title: string, rows: SlipDocumentRow[]) {
  sectionTitle(state, title);
  if (rows.length === 0) {
    text(state.doc, "ไม่มีรายการ", RECEIPT_MARGIN + 3, state.y, CONTENT_WIDTH - 6, {
      size: 7.5,
      color: PDF_PALETTE.muted,
    });
    state.y += 18;
    return;
  }

  const amountWidth = 60;
  const labelWidth = CONTENT_WIDTH - amountWidth - 8;
  for (const row of rows) {
    const amount = `${moneyFormatter.format(row.amount)} บาท`;
    const details = [row.dateLabel, row.description].filter(Boolean).join(" · ");
    const labelHeight = textHeight(state.doc, row.label, labelWidth, { bold: true, size: 7.3 });
    const amountHeight = textHeight(state.doc, amount, amountWidth, {
      bold: true,
      size: 7.3,
      align: "right",
    });
    const descriptionHeight = details
      ? textHeight(state.doc, details, CONTENT_WIDTH - 6, { size: 6.8 }) + 3
      : 0;
    const rowHeight = Math.max(18, Math.max(labelHeight, amountHeight) + descriptionHeight + 7);
    text(state.doc, row.label, RECEIPT_MARGIN + 3, state.y + 3, labelWidth, { bold: true, size: 7.3 });
    text(state.doc, amount, RECEIPT_MARGIN + labelWidth + 5, state.y + 3, amountWidth, {
      bold: true,
      size: 7.3,
      align: "right",
    });
    if (details) {
      text(state.doc, details, RECEIPT_MARGIN + 3, state.y + 5 + Math.max(labelHeight, amountHeight), CONTENT_WIDTH - 6, {
        size: 6.8,
        color: PDF_PALETTE.muted,
      });
    }
    state.y += rowHeight;
    divider(state, 4);
  }
  state.y += 1;
}

function drawNotice(state: ReceiptState) {
  const height = textHeight(state.doc, state.document.notice, CONTENT_WIDTH - 12, { size: 7.2 }) + 12;
  state.doc.save().roundedRect(RECEIPT_MARGIN, state.y, CONTENT_WIDTH, height, 2).fill(PDF_PALETTE.paleGreen).restore();
  text(state.doc, state.document.notice, RECEIPT_MARGIN + 6, state.y + 6, CONTENT_WIDTH - 12, {
    size: 7.2,
    color: PDF_PALETTE.muted,
  });
  state.y += height + 14;
}

function drawSignatures(state: ReceiptState) {
  const gap = 12;
  const columnWidth = (CONTENT_WIDTH - gap) / 2;
  const lineY = state.y + 24;
  const labels = ["ผู้รับเงิน", "ผู้จ่ายเงิน"];
  labels.forEach((label, index) => {
    const x = RECEIPT_MARGIN + (index * (columnWidth + gap));
    state.doc.moveTo(x, lineY).lineTo(x + columnWidth, lineY).strokeColor(PDF_PALETTE.border).lineWidth(0.7).stroke();
    text(state.doc, label, x, lineY + 4, columnWidth, { bold: true, size: 7.4, align: "center" });
    text(state.doc, "วันที่ ____/____/______", x, lineY + 16, columnWidth, {
      size: 6.2,
      color: PDF_PALETTE.muted,
      align: "center",
    });
  });
  state.y = lineY + 33;
}

function renderDocument(doc: PdfDocument, document: TimePayrollSlipDocument) {
  const state: ReceiptState = { doc, document, y: RECEIPT_MARGIN };
  text(doc, "LanFlow", RECEIPT_MARGIN, state.y, 60, { bold: true, size: 9 });
  text(doc, document.statusLabel, RECEIPT_MARGIN + 70, state.y, CONTENT_WIDTH - 70, {
    bold: true,
    size: 7.5,
    align: "right",
    color: document.status === "APPROVED" ? PDF_PALETTE.darkGreen : "#8A5A00",
  });
  state.y += 19;
  const titleHeight = textHeight(doc, document.title, CONTENT_WIDTH, { bold: true, size: 14, align: "center" });
  text(doc, document.title, RECEIPT_MARGIN, state.y, CONTENT_WIDTH, { bold: true, size: 14, align: "center" });
  state.y += titleHeight + 10;

  sectionTitle(state, "ข้อมูลเอกสาร");
  keyValueRows(state, buildSlipDocumentDetailRows(document));
  sectionTitle(state, document.kind === "withdrawal" ? "สรุปค่าแรงประกอบการเบิกเงิน" : "สรุปเงินเดือน");
  keyValueRows(state, document.summary);
  if (document.calendar.length > 0) drawCalendar(state);
  if (document.kind === "payroll") {
    drawTransactionRows(state, "รายการหักเงิน", document.deductionRows);
    drawTransactionRows(state, "รายการหนี้สินและเบิกเงิน", document.sourceRows);
  }
  drawNotice(state);
  drawSignatures(state);
  state.y += 7;
  divider(state, 7);
  const reference = `รหัสอ้างอิง ${document.sourceId}`;
  text(doc, reference, RECEIPT_MARGIN, state.y, CONTENT_WIDTH, {
    size: 6.3,
    color: PDF_PALETTE.muted,
    align: "center",
  });
  state.y += textHeight(doc, reference, CONTENT_WIDTH, { size: 6.3, align: "center" });
  return state.y;
}

export function createTimePayrollSlipPdfFile(
  document: TimePayrollSlipDocument,
  signal: AbortSignal,
) {
  return createSearchableRollPdfFile({
    filename: document.filename,
    title: document.title,
    subject: `${document.title} ${document.statusLabel} กระดาษ 80 มม.`,
    signal,
    width: RECEIPT_WIDTH,
    margins: {
      top: RECEIPT_MARGIN,
      right: RECEIPT_MARGIN,
      bottom: RECEIPT_MARGIN,
      left: RECEIPT_MARGIN,
    },
    render: (doc) => renderDocument(doc, document),
  });
}
