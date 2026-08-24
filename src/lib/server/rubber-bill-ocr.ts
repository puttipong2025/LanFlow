import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

export const RUBBER_BILL_OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const RUBBER_BILL_OCR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RubberBillOcrDraft = {
  billDate: string | null;
  inWeight: number | null;
  outWeight: number | null;
  deductWeight: number | null;
  ocrTotal: number | null;
  suggestedPrice: number | null;
};

export type RubberBillOcrStoredSource = {
  id: string;
  owner_user_id: string;
  location_id: string;
  state: string;
  bill_date: string | null;
  in_weight: number | string | null;
  out_weight: number | string | null;
  deduct_weight: number | string | null;
  ocr_total: number | string | null;
  suggested_price: number | string | null;
};

export type RubberBillOcrExistingSourceResolution =
  | { kind: "none" }
  | { kind: "conflict" }
  | { kind: "replay"; uploadId: string; draft: RubberBillOcrDraft };

export class RubberBillOcrUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function rubberBillOcrError(
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { code, message, retryable },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        ...(status === 429 || status === 503 ? { "Retry-After": "3" } : {}),
      },
    },
  );
}

export function rubberBillOcrSuccess(uploadId: string, draft: RubberBillOcrDraft) {
  return NextResponse.json(
    { uploadId, draft },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export function detectRubberBillOcrImage(
  bytes: Uint8Array,
  claimedMimeType: string,
  size: number,
) {
  if (size <= 0 || size > RUBBER_BILL_OCR_MAX_IMAGE_BYTES) return null;
  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  if (claimedMimeType === "image/jpeg" && isJpeg) {
    return { mimeType: "image/jpeg" as const, extension: "jpg" as const };
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = bytes.length >= pngSignature.length
    && pngSignature.every((value, index) => bytes[index] === value);
  if (claimedMimeType === "image/png" && isPng) {
    return { mimeType: "image/png" as const, extension: "png" as const };
  }
  return null;
}

function nullableNumber(value: unknown) {
  if (typeof value === "string") value = value.replace(/,/g, "").trim();
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nullableIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function roundToTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function storedRubberBillOcrDraft(source: RubberBillOcrStoredSource): RubberBillOcrDraft {
  return {
    billDate: nullableIsoDate(source.bill_date),
    inWeight: nullableNumber(source.in_weight),
    outWeight: nullableNumber(source.out_weight),
    deductWeight: nullableNumber(source.deduct_weight),
    ocrTotal: nullableNumber(source.ocr_total),
    suggestedPrice: nullableNumber(source.suggested_price),
  };
}

export function resolveRubberBillOcrExistingSource(
  source: RubberBillOcrStoredSource | null,
  ownerUserId: string,
  locationId: string,
): RubberBillOcrExistingSourceResolution {
  if (!source) return { kind: "none" };
  if (source.state === "staged"
    && source.owner_user_id === ownerUserId
    && source.location_id === locationId) {
    return {
      kind: "replay",
      uploadId: source.id,
      draft: storedRubberBillOcrDraft(source),
    };
  }
  return { kind: "conflict" };
}

export function normalizeRubberBillOcrResult(value: unknown): RubberBillOcrDraft {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const billDate = nullableIsoDate(row.bill_date ?? row.date_in);
  const inWeight = nullableNumber(row.weight_in);
  const outWeight = nullableNumber(row.weight_out);
  const deductWeight = nullableNumber(row.weight_deducted);
  const ocrTotal = nullableNumber(row.total_amount);
  const postDeductNet = inWeight != null && outWeight != null
    ? Math.max(0, Math.abs(inWeight - outWeight) - (deductWeight ?? 0))
    : 0;
  const suggestedPrice = ocrTotal != null && postDeductNet > 0
    ? roundToTwo(ocrTotal / postDeductNet)
    : null;
  return { billDate, inWeight, outWeight, deductWeight, ocrTotal, suggestedPrice };
}

export function hashRubberBillOcrImage(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const OCR_PROMPT = `อ่านใบชั่งน้ำหนักสินค้าเกษตรไทยจากรูปหนึ่งรูป แล้วตอบ JSON object เท่านั้น
ฟิลด์: bill_date (YYYY-MM-DD), weight_in, weight_out, weight_deducted, total_amount
ถ้าอ่านฟิลด์ใดไม่ได้ให้เป็น null ตัวเลขต้องไม่มีหน่วยหรือจุลภาค ห้ามส่งเลขเอกสาร ทะเบียนรถ หรือข้อความอื่น`;

function parseModelJson(responseText: string) {
  const clean = responseText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(clean) as unknown;
  } catch {
    throw new RubberBillOcrUpstreamError(422, "OCR_INVALID_RESPONSE", "ผล OCR ไม่อยู่ในรูปแบบที่ใช้ได้", true);
  }
}

export async function readRubberBillOcrImage(
  buffer: Buffer,
  mimeType: "image/jpeg" | "image/png",
): Promise<RubberBillOcrDraft> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new RubberBillOcrUpstreamError(503, "OCR_NOT_CONFIGURED", "ระบบ OCR ยังไม่ได้ตั้งค่า", true);
  }
  const model = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lanflow.vercel.app",
        "X-Title": "LanFlow Rubber Bill OCR",
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
          ],
        }],
        max_tokens: 512,
        temperature: 0,
      }),
    });
  } catch {
    throw new RubberBillOcrUpstreamError(503, "OCR_UPSTREAM_UNAVAILABLE", "เชื่อมต่อระบบ OCR ไม่สำเร็จ", true);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new RubberBillOcrUpstreamError(429, "OCR_RATE_LIMITED", "ระบบ OCR มีงานมาก กรุณาลองใหม่", true);
    }
    throw new RubberBillOcrUpstreamError(503, "OCR_UPSTREAM_FAILED", "ระบบ OCR ประมวลผลไม่สำเร็จ", true);
  }

  const result = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new RubberBillOcrUpstreamError(422, "OCR_INVALID_RESPONSE", "ผล OCR ไม่อยู่ในรูปแบบที่ใช้ได้", true);
  }
  const draft = normalizeRubberBillOcrResult(parseModelJson(content));
  if (Object.values(draft).every((field) => field == null)) {
    throw new RubberBillOcrUpstreamError(422, "OCR_UNREADABLE", "ไม่สามารถอ่านข้อมูลใบชั่งจากรูปนี้ได้", true);
  }
  return draft;
}
