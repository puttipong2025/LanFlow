import { NextResponse } from "next/server";
import type { AuthTokenPayload } from "@/lib/server/auth";
import { hasSystemManagerAccess } from "@/lib/server/auth";

export const WEIGHT_EVIDENCE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canAccessEvidenceLocation(auth: AuthTokenPayload, locationId: string) {
  return UUID_PATTERN.test(locationId)
    && (hasSystemManagerAccess(auth) || auth.locationIds.includes(locationId));
}
export function evidenceError(
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { error: { code, message, retryable } },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export function parseCompletionPayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.locationId !== "string"
    || !UUID_PATTERN.test(payload.locationId)
    || typeof payload.completionId !== "string"
    || !UUID_PATTERN.test(payload.completionId)
    || typeof payload.revisionNo !== "number"
    || !Number.isInteger(payload.revisionNo)
    || payload.revisionNo < 0
  ) return null;
  return {
    locationId: payload.locationId,
    completionId: payload.completionId,
    revisionNo: payload.revisionNo,
  };
}

export function parseOcrModelResponse(responseText: string): number | null {
  const clean = responseText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(clean) as { values?: unknown; confidence?: unknown };
    if (parsed.confidence !== "high" || !Array.isArray(parsed.values) || parsed.values.length !== 1) return null;
    const value = parsed.values[0];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
