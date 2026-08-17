import { NextResponse } from "next/server";
import type { AuthTokenPayload } from "@/lib/server/auth";
import { hasSystemManagerAccess } from "@/lib/server/auth";

export const WEIGHT_EVIDENCE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const WEIGHT_EVIDENCE_MAX_BACKUP_IMAGE_BYTES = 4 * 1024 * 1024;
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

function parseIdentityPayload(value: unknown) {
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

export function parseCompletionIdentityPayload(value: unknown) {
  const payload = parseIdentityPayload(value);
  if (!payload || Object.keys(value as object).some(
    (key) => !["locationId", "completionId", "revisionNo"].includes(key),
  )) return null;
  return payload;
}

export function parseCompletionClaimPayload(value: unknown) {
  const payload = parseIdentityPayload(value);
  if (!payload || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(
    (key) => !["locationId", "completionId", "revisionNo", "manualCorrectionCount"].includes(key),
  )) return null;
  if (record.manualCorrectionCount === undefined) return payload;
  if (
    typeof record.manualCorrectionCount !== "number"
    || !Number.isInteger(record.manualCorrectionCount)
    || record.manualCorrectionCount < 0
  ) return null;
  return { ...payload, manualCorrectionCount: record.manualCorrectionCount };
}

export const WEIGHT_EVIDENCE_BACKUP_ROLES = ["rubber", "displayIn", "displayOut"] as const;
export type WeightEvidenceBackupRole = (typeof WEIGHT_EVIDENCE_BACKUP_ROLES)[number];

export function isWeightEvidenceBackupRole(value: string): value is WeightEvidenceBackupRole {
  return (WEIGHT_EVIDENCE_BACKUP_ROLES as readonly string[]).includes(value);
}

export function parseBackupIdentityHeaders(headers: Headers) {
  const locationId = headers.get("x-lanflow-location-id") ?? "";
  const completionId = headers.get("x-lanflow-completion-id") ?? "";
  const revisionNo = Number(headers.get("x-lanflow-revision-no"));
  if (
    !UUID_PATTERN.test(locationId)
    || !UUID_PATTERN.test(completionId)
    || !Number.isInteger(revisionNo)
    || revisionNo < 0
  ) return null;
  return { locationId, completionId, revisionNo };
}

export type OcrModelResult =
  | { status: "readable"; weight: number }
  | { status: "confirmed_unreadable" }
  | { status: "invalid_response" };

export function parseOcrModelResponse(responseText: string): OcrModelResult {
  const clean = responseText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(clean) as { values?: unknown; confidence?: unknown };
    if (
      !Array.isArray(parsed.values)
      || !["high", "low"].includes(String(parsed.confidence))
      || parsed.values.some(
        (value) => typeof value !== "number" || !Number.isFinite(value) || value < 0,
      )
    ) return { status: "invalid_response" };
    if (parsed.confidence === "low" || parsed.values.length !== 1) {
      return { status: "confirmed_unreadable" };
    }
    return { status: "readable", weight: parsed.values[0] as number };
  } catch {
    return { status: "invalid_response" };
  }
}

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
