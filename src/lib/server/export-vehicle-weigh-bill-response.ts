import { NextResponse } from "next/server";

import { hasSystemManagerAccess, type AuthTokenPayload } from "@/lib/server/auth";
import type {
  WexDetails,
  WexLineInput,
  WexSummary,
} from "@/types/export-vehicle-weigh-bills";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type JsonRecord = Record<string, unknown>;

export type CreateExportVehicleWeighBillPayload = {
  locationId: string;
  lines: WexLineInput[];
  rubberExportIds: string[];
};

export type UpdateExportVehicleWeighBillPayload = Omit<CreateExportVehicleWeighBillPayload, "locationId"> & {
  expectedRevision: number;
};

export function isWexUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function canManageExportVehicleWeighBills(auth: AuthTokenPayload, locationId: string) {
  return hasSystemManagerAccess(auth)
    || (auth.role === "admin" && auth.locationIds.includes(locationId));
}

export function withExportVehicleWeighBillNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export function exportVehicleWeighBillJson(
  body: unknown,
  init: { status?: number } = {},
) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}

export function exportVehicleWeighBillErrorResponse(message: string) {
  const status = message.includes("WEX_INVALID")
    ? 400
    : message.includes("WEX_FORBIDDEN") || message.includes("ไม่มีสิทธิ์")
      ? 403
      : message.includes("WEX_NOT_FOUND") || message.includes("ไม่พบ")
        ? 404
        : message.includes("WEX_STALE")
          || message.includes("WEX_REX_")
          || message.includes("WEX_CARRIER_")
          || message.includes("WEX_OVERWEIGHT")
          || message.includes("WEX_RESERVATION_LOCKED")
          || message.includes("ถูกจอง")
          ? 409
          : 500;
  return exportVehicleWeighBillJson({ error: message }, { status });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTwoDecimalPositiveNumber(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= 999_999_999_999.99
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

function normalizeLines(value: unknown): WexLineInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;

  const lines: WexLineInput[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const vehicleRegistration = typeof raw.vehicleRegistration === "string"
      ? raw.vehicleRegistration.trim().replace(/\s+/gu, " ")
      : "";
    if (
      raw.carrierId !== undefined
      && raw.carrierId !== null
      && typeof raw.carrierId !== "string"
    ) return null;
    if (
      raw.carrierName !== undefined
      && raw.carrierName !== null
      && typeof raw.carrierName !== "string"
    ) return null;
    const carrierId = typeof raw.carrierId === "string" && raw.carrierId.trim()
      ? raw.carrierId.trim()
      : null;
    const carrierName = typeof raw.carrierName === "string"
      ? raw.carrierName.trim().replace(/\s+/gu, " ") || null
      : null;
    const inboundAt = raw.inboundAt;
    const outboundAt = raw.outboundAt;
    if (
      !vehicleRegistration
      || vehicleRegistration.length > 64
      || (carrierId !== null && !isWexUuid(carrierId))
      || typeof inboundAt !== "string"
      || typeof outboundAt !== "string"
      || !Number.isFinite(Date.parse(inboundAt))
      || !Number.isFinite(Date.parse(outboundAt))
      || Date.parse(outboundAt) <= Date.parse(inboundAt)
      || !isTwoDecimalPositiveNumber(raw.inboundWeight)
      || !isTwoDecimalPositiveNumber(raw.outboundWeight)
      || Math.round(raw.outboundWeight * 100) <= Math.round(raw.inboundWeight * 100)
    ) return null;
    lines.push({
      vehicleRegistration,
      carrierId,
      carrierName,
      inboundAt,
      inboundWeight: raw.inboundWeight,
      outboundAt,
      outboundWeight: raw.outboundWeight,
    });
  }

  if (new Set(lines.map((item) => item.vehicleRegistration.toLocaleLowerCase("th-TH"))).size !== lines.length) {
    return null;
  }
  return lines;
}

function normalizeRubberExportIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => !isWexUuid(id))) return null;
  return new Set(value).size === value.length ? [...value] : null;
}

export function parseCreateExportVehicleWeighBillPayload(
  value: unknown,
): CreateExportVehicleWeighBillPayload | null {
  if (!isRecord(value) || !isWexUuid(value.locationId)) return null;
  const lines = normalizeLines(value.lines);
  const rubberExportIds = normalizeRubberExportIds(value.rubberExportIds);
  return lines && rubberExportIds
    ? { locationId: value.locationId, lines, rubberExportIds }
    : null;
}

export function parseUpdateExportVehicleWeighBillPayload(
  value: unknown,
): UpdateExportVehicleWeighBillPayload | null {
  if (!isRecord(value) || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    return null;
  }
  const lines = normalizeLines(value.lines);
  const rubberExportIds = normalizeRubberExportIds(value.rubberExportIds);
  return lines && rubberExportIds
    ? { expectedRevision: Number(value.expectedRevision), lines, rubberExportIds }
    : null;
}

export function parseDeleteExportVehicleWeighBillPayload(value: unknown) {
  if (!isRecord(value) || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    return null;
  }
  return { expectedRevision: Number(value.expectedRevision) };
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relation(value: unknown): JsonRecord | undefined {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : undefined;
  return isRecord(value) ? value : undefined;
}

export function mapExportVehicleWeighBillSummary(row: JsonRecord): WexSummary {
  const lines = Array.isArray(row.export_vehicle_weigh_lines)
    ? row.export_vehicle_weigh_lines.filter(isRecord)
    : [];
  const reservations = Array.isArray(row.export_vehicle_weigh_bill_reservations)
    ? row.export_vehicle_weigh_bill_reservations.filter(isRecord)
    : [];
  const vehicleNetWeight = number(row.vehicle_net_weight)
    || lines.reduce((sum, item) => sum + number(item.net_weight), 0);
  const reservedRubberWeight = number(row.reserved_rubber_weight)
    || reservations.reduce((sum, item) => sum + number(item.current_weight), 0);
  const location = relation(row.locations);
  return {
    id: String(row.id),
    wexNo: String(row.wex_no),
    locationId: String(row.location_id),
    locationName: String(location?.name ?? row.location_name ?? ""),
    revision: number(row.revision),
    vehicleCount: number(row.vehicle_count) || lines.length,
    rubberExportCount: number(row.rubber_export_count) || reservations.length,
    vehicleNetWeight,
    reservedRubberWeight,
    remainingWeight: number(row.remaining_weight) || vehicleNetWeight - reservedRubberWeight,
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapExportVehicleWeighBillDetail(value: unknown): WexDetails | null {
  if (!isRecord(value)) return null;
  const lines = Array.isArray(value.lines) ? value.lines.filter(isRecord) : [];
  const rubberExports = Array.isArray(value.rubberExports)
    ? value.rubberExports.filter(isRecord)
    : [];
  return {
    id: String(value.id),
    wexNo: String(value.wexNo),
    locationId: String(value.locationId),
    locationName: String(value.locationName),
    revision: number(value.revision),
    vehicleCount: number(value.vehicleCount),
    rubberExportCount: number(value.rubberExportCount),
    vehicleNetWeight: number(value.vehicleNetWeight),
    reservedRubberWeight: number(value.reservedRubberWeight),
    remainingWeight: number(value.remainingWeight),
    createdByName: String(value.createdByName),
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
    lines: lines.map((item) => ({
      id: String(item.id),
      sequenceNo: number(item.sequenceNo),
      vehicleRegistration: String(item.vehicleRegistration),
      carrierId: typeof item.carrierId === "string" ? item.carrierId : null,
      carrierName: typeof item.carrierName === "string" ? item.carrierName : null,
      inboundAt: String(item.inboundAt),
      inboundWeight: number(item.inboundWeight),
      outboundAt: String(item.outboundAt),
      outboundWeight: number(item.outboundWeight),
      netWeight: number(item.netWeight),
    })),
    rubberExports: rubberExports.map((item) => ({
      rubberExportId: String(item.rubberExportId),
      exportNo: String(item.exportNo),
      currentWeight: number(item.currentWeight),
    })),
  };
}
