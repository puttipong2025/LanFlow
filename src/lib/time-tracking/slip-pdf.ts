import {
  A4_PORTRAIT,
  PDF_PALETTE,
  applyTextStyle,
  createSearchableA4PdfFile,
  drawActualText,
  type PdfDocument,
} from "@/lib/pdf/searchable-a4";
import type {
  SlipDocumentRow,
  TimePayrollSlipDocument,
} from "@/lib/time-tracking/slip-document";

const moneyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "short",
});

type PortraitState = {
  doc: PdfDocument;
  document: TimePayrollSlipDocument;
  y: number;
};

function text(
  doc: PdfDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  options: { bold?: boolean; size?: number; color?: string; align?: "left" | "right" | "center" } = {},
) {
  applyTextStyle(doc, {
    text: value,
    bold: options.bold,
    fontSize: options.size,
    color: options.color,
  });
  drawActualText(doc, value, x, y, {
    width,
    align: options.align || "left",
    lineGap: 1,
  });
}

function addPage(state: PortraitState) {
  state.doc.addPage({
    size: "A4",
    layout: "portrait",
    margins: { top: A4_PORTRAIT.top, right: A4_PORTRAIT.left, bottom: 40, left: A4_PORTRAIT.left },
  });
  state.y = A4_PORTRAIT.top;
  text(state.doc, `${state.document.title} (ต่อ)`, A4_PORTRAIT.left, state.y, A4_PORTRAIT.contentWidth, {
    bold: true,
    size: 13,
    color: PDF_PALETTE.darkGreen,
  });
  state.y += 24;
}

function ensureSpace(state: PortraitState, height: number) {
  if (state.y + height > A4_PORTRAIT.bottom) addPage(state);
}

function thaiDate(value: string | null) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
}

function sectionTitle(state: PortraitState, title: string) {
  ensureSpace(state, 30);
  state.doc
    .save()
    .rect(A4_PORTRAIT.left, state.y, A4_PORTRAIT.contentWidth, 24)
    .fill(PDF_PALETTE.paleGreen)
    .restore();
  text(state.doc, title, A4_PORTRAIT.left + 8, state.y + 5, A4_PORTRAIT.contentWidth - 16, {
    bold: true,
    size: 11,
  });
  state.y += 30;
}

function keyValueRows(state: PortraitState, rows: Array<{ label: string; value: string }>) {
  for (const row of rows) {
    applyTextStyle(state.doc, { text: row.label, fontSize: 10 });
    const labelHeight = state.doc.heightOfString(row.label, { width: 245, lineGap: 1 });
    applyTextStyle(state.doc, { text: row.value, bold: true, fontSize: 10 });
    const valueHeight = state.doc.heightOfString(row.value, {
      width: A4_PORTRAIT.contentWidth - 266,
      align: "right",
      lineGap: 1,
    });
    const rowHeight = Math.max(25, Math.max(labelHeight, valueHeight) + 10);
    ensureSpace(state, rowHeight);
    text(state.doc, row.label, A4_PORTRAIT.left + 6, state.y + 4, 245, {
      color: PDF_PALETTE.muted,
      size: 10,
    });
    text(state.doc, row.value, A4_PORTRAIT.left + 260, state.y + 4, A4_PORTRAIT.contentWidth - 266, {
      bold: true,
      size: 10,
      align: "right",
    });
    state.doc
      .moveTo(A4_PORTRAIT.left, state.y + rowHeight - 3)
      .lineTo(A4_PORTRAIT.left + A4_PORTRAIT.contentWidth, state.y + rowHeight - 3)
      .strokeColor("#D4DED8")
      .stroke();
    state.y += rowHeight;
  }
  state.y += 5;
}

function drawCalendar(state: PortraitState) {
  sectionTitle(state, `ตารางการทำงาน เดือน ${state.document.month}`);
  const columnWidth = A4_PORTRAIT.contentWidth / 7;
  const weekdays = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  ensureSpace(state, 22);
  weekdays.forEach((weekday, index) => {
    text(state.doc, weekday, A4_PORTRAIT.left + (index * columnWidth), state.y + 3, columnWidth, {
      bold: true,
      size: 9,
      align: "center",
    });
  });
  state.y += 22;

  const firstWeekday = new Date(`${state.document.month}-01T00:00:00+07:00`).getDay();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...state.document.calendar,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  for (let offset = 0; offset < cells.length; offset += 7) {
    ensureSpace(state, 34);
    cells.slice(offset, offset + 7).forEach((day, index) => {
      const x = A4_PORTRAIT.left + (index * columnWidth);
      const fill = !day
        ? PDF_PALETTE.white
        : day.paidDays >= 1
          ? PDF_PALETTE.darkGreen
          : day.paidDays > 0
            ? PDF_PALETTE.mint
            : PDF_PALETTE.white;
      const color = day?.paidDays && day.paidDays >= 1 ? PDF_PALETTE.white : PDF_PALETTE.darkGreen;
      state.doc.save().rect(x, state.y, columnWidth, 31).fillAndStroke(fill, "#C9D4CD").restore();
      if (day) {
        const label = day.paidDays > 0 && day.paidDays < 1
          ? `${day.day}\n${moneyFormatter.format(day.paidDays)} วัน`
          : String(day.day);
        text(state.doc, label, x + 2, state.y + 5, columnWidth - 4, {
          bold: true,
          size: day.paidDays > 0 && day.paidDays < 1 ? 7 : 9,
          color,
          align: "center",
        });
      }
    });
    state.y += 34;
  }
  state.y += 5;
}

function drawTransactionTable(state: PortraitState, title: string, rows: SlipDocumentRow[]) {
  sectionTitle(state, title);
  if (rows.length === 0) {
    text(state.doc, "ไม่มีรายการ", A4_PORTRAIT.left + 6, state.y, A4_PORTRAIT.contentWidth - 12, {
      size: 9,
      color: PDF_PALETTE.muted,
    });
    state.y += 24;
    return;
  }

  for (const row of rows) {
    const description = `${row.label}${row.description ? ` · ${row.description}` : ""}`;
    applyTextStyle(state.doc, { text: description, fontSize: 9 });
    const rowHeight = Math.max(24, state.doc.heightOfString(description, { width: 330, lineGap: 1 }) + 10);
    ensureSpace(state, rowHeight);
    text(state.doc, description, A4_PORTRAIT.left + 6, state.y + 4, 330, { size: 9 });
    text(
      state.doc,
      `${moneyFormatter.format(row.amount)} บาท`,
      A4_PORTRAIT.left + 350,
      state.y + 4,
      A4_PORTRAIT.contentWidth - 356,
      { bold: true, size: 9, align: "right" },
    );
    state.doc
      .moveTo(A4_PORTRAIT.left, state.y + rowHeight - 2)
      .lineTo(A4_PORTRAIT.left + A4_PORTRAIT.contentWidth, state.y + rowHeight - 2)
      .strokeColor("#D4DED8")
      .stroke();
    state.y += rowHeight;
  }
  state.y += 5;
}

function drawFooters(doc: PdfDocument, documentNo: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const footer = `${documentNo} · หน้า ${index + 1}/${range.count}`;
    text(doc, footer, A4_PORTRAIT.left, A4_PORTRAIT.height - 54, A4_PORTRAIT.contentWidth, {
      size: 8,
      color: PDF_PALETTE.muted,
      align: "right",
    });
  }
}

function renderDocument(doc: PdfDocument, document: TimePayrollSlipDocument) {
  const state: PortraitState = { doc, document, y: A4_PORTRAIT.top };
  text(doc, "LanFlow", A4_PORTRAIT.left, state.y, 120, { bold: true, size: 12 });
  text(doc, document.statusLabel, A4_PORTRAIT.left + 350, state.y, A4_PORTRAIT.contentWidth - 350, {
    bold: true,
    size: 10,
    align: "right",
    color: document.status === "APPROVED" ? PDF_PALETTE.darkGreen : "#8A5A00",
  });
  state.y += 24;
  text(doc, document.title, A4_PORTRAIT.left, state.y, A4_PORTRAIT.contentWidth, {
    bold: true,
    size: 23,
    align: "center",
  });
  state.y += 38;

  const detailRows = [
    { label: "ชื่อพนักงาน", value: document.employeeName },
    { label: "เดือน", value: document.month },
    ...(document.amount == null ? [] : [{ label: "ยอดเบิก", value: `${moneyFormatter.format(document.amount)} บาท` }]),
    ...(document.effectiveDate ? [{ label: "วันที่รายการ", value: thaiDate(`${document.effectiveDate}T00:00:00+07:00`) }] : []),
    { label: "วันที่สร้างคำขอ/สลิป", value: thaiDate(document.createdAt) },
    ...(document.description ? [{ label: "รายละเอียด", value: document.description }] : []),
    { label: "รหัสอ้างอิง", value: document.sourceId },
    ...(document.approverName ? [{ label: "ผู้อนุมัติ", value: document.approverName }] : []),
    ...(document.approvedAt ? [{ label: "วันที่อนุมัติ", value: thaiDate(document.approvedAt) }] : []),
    ...(document.paymentLabel ? [{ label: "วิธีจ่าย", value: document.paymentLabel }] : []),
    ...(document.adminComment ? [{ label: "หมายเหตุผู้อนุมัติ", value: document.adminComment }] : []),
    { label: "สร้างเอกสารเมื่อ", value: thaiDate(document.generatedAt) },
  ];
  sectionTitle(state, "ข้อมูลเอกสาร");
  keyValueRows(state, detailRows);
  sectionTitle(state, document.kind === "withdrawal" ? "สรุปค่าแรงประกอบการเบิกเงิน" : "สรุปเงินเดือน");
  keyValueRows(state, document.summary);
  drawCalendar(state);
  if (document.kind === "payroll") {
    drawTransactionTable(state, "รายการหักเงิน", document.deductionRows);
    drawTransactionTable(state, "รายการหนี้สินและเบิกเงิน", document.sourceRows);
  }

  applyTextStyle(doc, { text: document.notice, fontSize: 9 });
  const noticeHeight = doc.heightOfString(document.notice, { width: A4_PORTRAIT.contentWidth - 16 }) + 18;
  ensureSpace(state, noticeHeight);
  doc.save().rect(A4_PORTRAIT.left, state.y, A4_PORTRAIT.contentWidth, noticeHeight).fill(PDF_PALETTE.paleGreen).restore();
  text(doc, document.notice, A4_PORTRAIT.left + 8, state.y + 7, A4_PORTRAIT.contentWidth - 16, {
    size: 9,
    color: PDF_PALETTE.muted,
  });
  drawFooters(doc, document.sourceId);
}

export function createTimePayrollSlipPdfFile(
  document: TimePayrollSlipDocument,
  signal: AbortSignal,
) {
  return createSearchableA4PdfFile({
    filename: document.filename,
    title: document.title,
    subject: `${document.title} ${document.statusLabel}`,
    signal,
    layout: "portrait",
    render: (doc) => renderDocument(doc, document),
  });
}
