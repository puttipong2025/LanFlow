import type { RubberExportDetails } from "@/types/rubber-exports";
import {
  A4_LANDSCAPE,
  PDF_PALETTE,
  applyTextStyle,
  createSearchableA4PdfFile,
  drawActualText,
  drawPageFooters,
  drawTable,
  type PdfCell,
  type PdfDocument,
  type PdfState,
} from "@/lib/pdf/searchable-a4";
import {
  buildRubberExportPresentation,
  formatRubberExportDateTime,
  rubberExportPdfFilename,
} from "@/lib/rubber-exports/rubber-export-presentation";

function header(text: string, align: "left" | "right" = "left"): PdfCell {
  return {
    text,
    align,
    bold: true,
    fontSize: 10,
    fill: PDF_PALETTE.mint,
  };
}

function data(text: string, align: "left" | "right" | "center" = "left"): PdfCell {
  return { text, align, fontSize: 10 };
}

function drawHeader(
  state: PdfState,
  details: RubberExportDetails,
  status: string,
) {
  const { doc } = state;
  applyTextStyle(doc, { text: "", bold: true, fontSize: 18 });
  drawActualText(doc, "รายการส่งออกยาง", A4_LANDSCAPE.left, state.y, {
    width: A4_LANDSCAPE.tableWidth,
    height: 26,
  });
  state.y += 30;

  const metadata = [
    `เลขที่: ${details.exportNo}`,
    `สาขา: ${details.locationName}`,
    `สถานะ: ${status}`,
    `จำนวนบิล: ${details.itemCount.toLocaleString("th-TH")}`,
    `สร้างเมื่อ: ${formatRubberExportDateTime(details.createdAt)}`,
  ];
  const width = A4_LANDSCAPE.tableWidth / 4;
  metadata.forEach((text, index) => {
    applyTextStyle(doc, {
      text,
      bold: false,
      fontSize: 11,
      color: PDF_PALETTE.darkGreen,
    });
    drawActualText(
      doc,
      text,
      A4_LANDSCAPE.left + ((index % 4) * width),
      state.y + (Math.floor(index / 4) * 20),
      { width: index === 4 ? width * 2 : width, height: 19 },
    );
  });
  state.y += metadata.length > 4 ? 44 : 24;
  doc
    .save()
    .moveTo(A4_LANDSCAPE.left, state.y)
    .lineTo(A4_LANDSCAPE.width - A4_LANDSCAPE.left, state.y)
    .lineWidth(1.5)
    .strokeColor(PDF_PALETTE.darkGreen)
    .stroke()
    .restore();
  state.y += 11;
}

function drawRubberExportContent(doc: PdfDocument, details: RubberExportDetails) {
  const presentation = buildRubberExportPresentation(details);
  const state: PdfState = { doc, y: A4_LANDSCAPE.top };

  drawHeader(state, details, presentation.status);

  const summaryRows: PdfCell[][] = Array.from(
    { length: Math.ceil(presentation.summary.length / 4) },
    (_, row) => row * 4,
  ).map((offset) =>
    presentation.summary.slice(offset, offset + 4).flatMap(([label, value]) => [
      { text: label, fontSize: 10, bold: true, fill: PDF_PALETTE.mint },
      { text: value, fontSize: 13, bold: true, align: "right", fill: PDF_PALETTE.paleGreen },
    ]));
  drawTable(
    state,
    [105, 93, 105, 93, 105, 93, 105, 94],
    [
      { text: "สรุปรายการ", bold: true, fontSize: 13, fill: PDF_PALETTE.darkGreen, color: PDF_PALETTE.white, colSpan: 8 },
    ],
    summaryRows,
  );

  const itemRows: PdfCell[][] = presentation.items.length === 0
    ? [[{ text: "ไม่มีรายการ", align: "center", color: PDF_PALETTE.muted, colSpan: 7 }]]
    : presentation.items.map((item) => [
      data(item.billDateText),
      data(item.billNo),
      data(item.customerName),
      data(item.eligibilityAtText),
      data(item.netWeightText, "right"),
      data(item.paidAmountText, "right"),
      data(item.ageText, "right"),
    ]);
  drawTable(state, [65, 80, 140, 125, 100, 110, 173], [
    header("วันที่บิล"),
    header("เลขบิล"),
    header("ลูกค้า"),
    header("เวลาพร้อมออกรายงาน"),
    header("น้ำหนักสุทธิ", "right"),
    header("ยอดจ่ายจริง", "right"),
    header("อายุยาง", "right"),
  ], itemRows);

  drawTable(state, [396, 397], [
    header("ผู้สร้าง"),
    header("ผู้ตรวจสอบ"),
  ], [[
    data(presentation.audit.created),
    data(presentation.audit.verified),
  ]]);
}

export function createRubberExportPdfFile(
  details: RubberExportDetails,
  signal: AbortSignal,
) {
  if (details.status === "draft") {
    throw new Error("แชร์ PDF ได้เฉพาะรายการตรวจสอบแล้ว");
  }
  return createSearchableA4PdfFile({
    filename: rubberExportPdfFilename(details),
    title: `รายการส่งออกยาง ${details.exportNo}`,
    subject: `รายการส่งออกยาง ${details.locationName}`,
    signal,
    render(doc) {
      drawRubberExportContent(doc, details);
      drawPageFooters(doc, details.exportNo);
    },
  });
}
