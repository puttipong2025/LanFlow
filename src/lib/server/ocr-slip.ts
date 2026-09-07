export const OCR_SLIP_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const OCR_SLIP_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type OcrSlipResult = {
  amount: number | null;
  reference_number: string | null;
  fee: number | null;
  sender_name: string | null;
  receiver_name: string | null;
  transaction_date: string | null;
};

function nullableText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("OCR_INVALID_RESPONSE");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error("OCR_INVALID_RESPONSE");
  return normalized;
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "number"
    && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))
  ) {
    throw new Error("OCR_INVALID_RESPONSE");
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
    throw new Error("OCR_INVALID_RESPONSE");
  }
  return amount;
}

function nullableTransactionDate(value: unknown) {
  const text = nullableText(value, 40);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    throw new Error("OCR_INVALID_RESPONSE");
  }
  const parsed = new Date(`${text}+07:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("OCR_INVALID_RESPONSE");
  const normalized = new Date(parsed.getTime() + 7 * 60 * 60 * 1_000).toISOString();
  if (normalized.slice(0, text.length) !== text) throw new Error("OCR_INVALID_RESPONSE");
  return text;
}

export function parseOcrSlipResponseText(responseText: string): OcrSlipResult {
  const clean = responseText.trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error("OCR_INVALID_RESPONSE");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OCR_INVALID_RESPONSE");
  }
  const row = value as Record<string, unknown>;
  const result = {
    amount: nullableMoney(row.amount),
    reference_number: nullableText(row.reference_number, 100),
    fee: nullableMoney(row.fee),
    sender_name: nullableText(row.sender_name, 200),
    receiver_name: nullableText(row.receiver_name, 200),
    transaction_date: nullableTransactionDate(row.transaction_date),
  };
  if (
    result.amount === null
    && result.reference_number === null
    && result.sender_name === null
    && result.receiver_name === null
    && result.transaction_date === null
  ) {
    throw new Error("OCR_UNREADABLE");
  }
  return result;
}
