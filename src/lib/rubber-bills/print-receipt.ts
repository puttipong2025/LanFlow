function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function jpegPdf(
  jpeg: Uint8Array,
  imageWidthPx: number,
  imageHeightPx: number,
  pageWidthMm = 80
) {
  const encode = (value: string) => new TextEncoder().encode(value);
  const pageWidth = pageWidthMm * 72 / 25.4;
  const imageWidth = pageWidth;
  const imageHeight = imageHeightPx * imageWidth / imageWidthPx;
  const pageHeight = imageHeight;
  const content = encode(
    `q\n${imageWidth.toFixed(3)} 0 0 ${imageHeight.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`
  );
  const objects = [
    encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] `
      + "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
    ),
    concatBytes([
      encode(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidthPx} /Height ${imageHeightPx} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
      ),
      jpeg,
      encode("\nendstream"),
    ]),
    concatBytes([
      encode(`<< /Length ${content.length} >>\nstream\n`),
      content,
      encode("endstream"),
    ]),
  ];

  const header = concatBytes([
    encode("%PDF-1.4\n%"),
    new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]),
    encode("\n"),
  ]);
  const parts = [header];
  const offsets = [0];
  let offset = header.length;
  objects.forEach((object, index) => {
    const prefix = encode(`${index + 1} 0 obj\n`);
    const suffix = encode("\nendobj\n");
    offsets.push(offset);
    parts.push(prefix, object, suffix);
    offset += prefix.length + object.length + suffix.length;
  });

  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((item) => `${item.toString().padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  parts.push(encode(xref));
  return concatBytes(parts);
}

function abortError() {
  const error = new Error("ยกเลิกการสร้าง PDF");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }),
  ]);
}

async function receiptCanvas(html: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "100mm";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  try {
    const frameDocument = iframe.contentDocument;
    if (!frameDocument) throw new Error("ไม่สามารถสร้างเอกสาร PDF ได้");
    frameDocument.open();
    frameDocument.write(html);
    frameDocument.close();
    await abortable(new Promise<void>((resolve) => {
      if (frameDocument.readyState === "complete") resolve();
      else iframe.addEventListener("load", () => resolve(), { once: true });
    }), signal);
    if (frameDocument.fonts?.ready) await abortable(frameDocument.fonts.ready, signal);
    throwIfAborted(signal);

    const body = frameDocument.body;
    const width = Math.max(1, Math.ceil(body.getBoundingClientRect().width));
    const height = Math.max(1, Math.ceil(body.scrollHeight));
    const styles = Array.from(frameDocument.head.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n")
      .replace(/\bbody\s*\{/g, ".receipt-pdf-root {");
    const root = frameDocument.createElement("div");
    root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    root.className = "receipt-pdf-root";
    const style = frameDocument.createElement("style");
    style.textContent = styles;
    root.append(style, ...Array.from(body.childNodes).map((node) => node.cloneNode(true)));
    const serializedRoot = new XMLSerializer().serializeToString(root);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
      `<foreignObject width="100%" height="100%">`,
      `${serializedRoot}</foreignObject></svg>`,
    ].join("");
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    await abortable(new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("ไม่สามารถแปลงใบรายการเป็นภาพ PDF ได้"));
      image.src = imageUrl;
    }), signal);
    throwIfAborted(signal);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("ไม่สามารถสร้างภาพสำหรับ PDF ได้");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    iframe.remove();
  }
}

function canvasJpeg(canvas: HTMLCanvasElement, signal?: AbortSignal) {
  return abortable(new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("ไม่สามารถสร้างข้อมูล PDF ได้"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/jpeg", 0.95);
  }), signal);
}

export function receiptPdfFilename(prefix: string, referenceNo: string) {
  const safeReference = referenceNo
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "receipt";
  return `${prefix}-${safeReference}-80mm.pdf`;
}

async function createReceiptPdfBlob(html: string, signal?: AbortSignal) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("บันทึก PDF ได้เฉพาะใน browser");
  }
  const canvas = await receiptCanvas(html, signal);
  const jpeg = await canvasJpeg(canvas, signal);
  throwIfAborted(signal);
  const pdf = jpegPdf(jpeg, canvas.width, canvas.height);
  return new Blob([pdf], { type: "application/pdf" });
}

function downloadReceiptPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export type ShareReceiptPdfResult = "shared" | "downloaded" | "cancelled";

export async function shareReceiptPdf(
  html: string,
  filename: string,
  options: {
    signal?: AbortSignal;
    onBeforeHandoff?: () => void | Promise<void>;
  } = {},
): Promise<ShareReceiptPdfResult> {
  const blob = await createReceiptPdfBlob(html, options.signal);
  throwIfAborted(options.signal);
  await options.onBeforeHandoff?.();
  throwIfAborted(options.signal);

  let file: File | null = null;
  let canShareFile = false;
  if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      file = new File([blob], filename, { type: "application/pdf" });
      canShareFile = navigator.canShare({ files: [file] });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled" as const;
      }
    }
  }

  if (canShareFile && file) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared" as const;
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "name" in error
        && error.name === "AbortError"
      ) {
        return "cancelled" as const;
      }
    }
  }

  downloadReceiptPdfBlob(blob, filename);
  return "downloaded" as const;
}
