import { requireAuth } from "@/lib/server/auth";
import {
  evidenceError,
  noStoreJson,
  parseOcrModelResponse,
  WEIGHT_EVIDENCE_MAX_IMAGE_BYTES,
} from "@/lib/server/weight-evidence";

export const dynamic = "force-dynamic";

const PROMPT = `Read exactly one displayed weight from this scale display image.
Return JSON only: {"values":[number],"confidence":"high"|"low"}.
Remove commas and kg/กก. units. Include every plausible displayed weight in values.
Use confidence low when blurred, cropped, ambiguous, or uncertain. Negative values are invalid.`;

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) return evidenceError(503, "OCR_NOT_CONFIGURED", "ระบบ OCR ยังไม่พร้อมใช้งาน", true);

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File)) return evidenceError(400, "IMAGE_REQUIRED", "กรุณาส่งรูปจอแสดงผล");
  if (image.type !== "image/jpeg" || image.size <= 0 || image.size > WEIGHT_EVIDENCE_MAX_IMAGE_BYTES) {
    return evidenceError(400, "INVALID_IMAGE", "รองรับเฉพาะ JPEG ขนาดไม่เกิน 8 MB");
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://lanflow.vercel.app",
      "X-Title": "LanFlow Weight Evidence OCR",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 128,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } },
        ],
      }],
    }),
  }).catch(() => null);
  if (!upstream) return evidenceError(503, "OCR_UPSTREAM_UNAVAILABLE", "เชื่อมต่อ OCR ไม่สำเร็จ", true);
  if (!upstream.ok) {
    console.error("Weight evidence OCR upstream status", upstream.status);
    return evidenceError(upstream.status === 429 ? 429 : 503, "OCR_UPSTREAM_FAILED", "OCR ไม่พร้อมใช้งานชั่วคราว", true);
  }

  const data = await upstream.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = data?.choices?.[0]?.message?.content;
  const ocrResult = typeof content === "string"
    ? parseOcrModelResponse(content)
    : { status: "invalid_response" as const };
  return noStoreJson(ocrResult);
}
