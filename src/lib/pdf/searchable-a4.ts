export const A4_LANDSCAPE = {
  width: 841.89,
  height: 595.28,
  left: 24,
  top: 24,
  bottom: 595.28 - 34,
  tableWidth: 841.89 - 48,
} as const;

export const A4_PORTRAIT = {
  width: 595.28,
  height: 841.89,
  left: 32,
  top: 32,
  bottom: 841.89 - 40,
  contentWidth: 595.28 - 64,
} as const;

export const PDF_PALETTE = {
  darkGreen: "#173B2A",
  mint: "#DDEFE3",
  paleGreen: "#EFF6F1",
  border: "#718078",
  muted: "#53645A",
  deleted: "#A12626",
  white: "#FFFFFF",
} as const;

const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 3;

export type PdfDocument = PDFKit.PDFDocument;
export type PdfAlignment = "left" | "right" | "center";

export type PdfCell = {
  text: string;
  align?: PdfAlignment;
  bold?: boolean;
  fontSize?: number;
  fill?: string;
  color?: string;
  colSpan?: number;
};

export type PdfState = {
  doc: PdfDocument;
  y: number;
};

function fontName(bold = false) {
  return bold ? "NotoSansThaiBold" : "NotoSansThai";
}

export function applyTextStyle(doc: PdfDocument, cell: PdfCell) {
  doc
    .font(fontName(cell.bold))
    .fontSize(cell.fontSize ?? 10)
    .fillColor(cell.color ?? PDF_PALETTE.darkGreen);
}

export function drawActualText(
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

export function rowHeight(doc: PdfDocument, row: PdfCell[], widths: number[]) {
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

export function drawRow(
  doc: PdfDocument,
  row: PdfCell[],
  widths: number[],
  y: number,
  height: number,
) {
  let x = A4_LANDSCAPE.left;
  let column = 0;
  for (const cell of row) {
    const span = cell.colSpan ?? 1;
    const width = cellWidth(widths, column, span);
    doc
      .save()
      .rect(x, y, width, height)
      .fillAndStroke(cell.fill ?? PDF_PALETTE.white, PDF_PALETTE.border)
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

export function addPage(state: PdfState) {
  state.doc.addPage({
    size: "A4",
    layout: "landscape",
    margins: {
      top: A4_LANDSCAPE.top,
      left: A4_LANDSCAPE.left,
      right: A4_LANDSCAPE.left,
      bottom: 34,
    },
  });
  state.y = A4_LANDSCAPE.top;
}

export function ensureSpace(state: PdfState, height: number) {
  if (state.y + height <= A4_LANDSCAPE.bottom) return;
  addPage(state);
}

export function drawTable(
  state: PdfState,
  widths: number[],
  header: PdfCell[],
  rows: PdfCell[][],
) {
  const headerHeight = rowHeight(state.doc, header, widths);
  const firstRowHeight = rows.length > 0 ? rowHeight(state.doc, rows[0], widths) : 22;
  if (state.y + headerHeight + firstRowHeight > A4_LANDSCAPE.bottom) addPage(state);

  const drawHeader = () => {
    drawRow(state.doc, header, widths, state.y, headerHeight);
    state.y += headerHeight;
  };
  drawHeader();

  for (const row of rows) {
    const height = rowHeight(state.doc, row, widths);
    if (state.y + height > A4_LANDSCAPE.bottom) {
      addPage(state);
      drawHeader();
    }
    drawRow(state.doc, row, widths, state.y, height);
    state.y += height;
  }
  state.y += 8;
}

export function drawPageFooters(doc: PdfDocument, documentNo: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const text = `${documentNo} · หน้า ${index + 1}/${range.count}`;
    applyTextStyle(doc, {
      text,
      fontSize: 9,
      color: PDF_PALETTE.muted,
    });
    drawActualText(
      doc,
      text,
      A4_LANDSCAPE.left,
      A4_LANDSCAPE.height - 24,
      {
        width: A4_LANDSCAPE.tableWidth,
        height: 14,
        align: "right",
        lineBreak: false,
      },
    );
  }
}

const PDF_FONT_ASSETS = {
  regular: {
    url: "/fonts/NotoSansThai-Regular.ttf",
    revision: "93659869b8ec5b7f78f14fa75d92575d",
  },
  bold: {
    url: "/fonts/NotoSansThai-Bold.ttf",
    revision: "4d3d19d16835fa81c3c4251858815e97",
  },
} as const;

function isSupportedFont(bytes: Uint8Array) {
  if (bytes.length < 4) return false;
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return (
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00)
    || signature === "OTTO"
    || signature === "true"
    || signature === "typ1"
    || signature === "wOFF"
    || signature === "wOF2"
  );
}

async function fetchFontBuffer(
  asset: (typeof PDF_FONT_ASSETS)[keyof typeof PDF_FONT_ASSETS],
  signal: AbortSignal,
) {
  const attempts: Array<{ url: string; cache: RequestCache }> = [
    { url: asset.url, cache: "force-cache" },
    { url: `${asset.url}?v=${asset.revision}`, cache: "reload" },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { signal, cache: attempt.cache });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (isSupportedFont(bytes)) return bytes;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }

  throw new Error("โหลดฟอนต์ภาษาไทยสำหรับ PDF ไม่สำเร็จ กรุณาลองใหม่");
}

async function loadFontBuffers(signal: AbortSignal) {
  const [regular, bold] = await Promise.all([
    fetchFontBuffer(PDF_FONT_ASSETS.regular, signal),
    fetchFontBuffer(PDF_FONT_ASSETS.bold, signal),
  ]);
  return { regular, bold };
}

function abortError() {
  return new DOMException("ยกเลิกการสร้าง PDF", "AbortError");
}

export async function createSearchableA4PdfFile({
  filename,
  title,
  subject,
  signal,
  layout = "landscape",
  render,
}: {
  filename: string;
  title: string;
  subject: string;
  signal: AbortSignal;
  layout?: "landscape" | "portrait";
  render: (doc: PdfDocument) => void;
}) {
  signal.throwIfAborted();
  const [{ default: PDFDocument }, fonts] = await Promise.all([
    import("pdfkit/js/pdfkit.standalone"),
    loadFontBuffers(signal),
  ]);
  signal.throwIfAborted();

  const doc = new PDFDocument({
    size: "A4",
    layout,
    bufferPages: true,
    compress: true,
    tagged: true,
    lang: "th-TH",
    info: {
      Title: title,
      Subject: subject,
      Author: "LanFlow",
    },
    margins: {
      top: layout === "portrait" ? A4_PORTRAIT.top : A4_LANDSCAPE.top,
      left: layout === "portrait" ? A4_PORTRAIT.left : A4_LANDSCAPE.left,
      right: layout === "portrait" ? A4_PORTRAIT.left : A4_LANDSCAPE.left,
      bottom: layout === "portrait" ? 40 : 34,
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
      render(doc);
      doc.end();
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      settled = true;
      reject(error);
    }
  });
  signal.throwIfAborted();

  return new File([blob], filename, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}
