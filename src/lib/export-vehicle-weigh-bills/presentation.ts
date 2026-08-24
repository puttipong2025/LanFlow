import type { WexDetails } from "@/types/export-vehicle-weigh-bills";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const MISSING_VALUE = "—";

export function formatExportVehicleWeighBillNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return MISSING_VALUE;
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatExportVehicleWeighBillDateTime(value: string | null | undefined) {
  if (!value) return MISSING_VALUE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return MISSING_VALUE;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(parsed);
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "export-vehicle-weigh-bill";
}

export function exportVehicleWeighBillPdfFilename(details: Pick<WexDetails, "wexNo">) {
  return `LanFlow-export-vehicle-weigh-bill-${sanitizeFilenamePart(details.wexNo)}-80mm.pdf`;
}

export function exportVehicleWeighBillShareTitle(
  details: Pick<WexDetails, "wexNo" | "locationName">,
) {
  return `บิลรถส่งออก ${details.wexNo} · ${details.locationName}`;
}

export function buildExportVehicleWeighBillPresentation(details: WexDetails) {
  return {
    createdAtText: formatExportVehicleWeighBillDateTime(details.createdAt),
    updatedAtText: formatExportVehicleWeighBillDateTime(details.updatedAt),
    summary: [
      ["น้ำหนักสุทธิรถรวม", `${formatExportVehicleWeighBillNumber(details.vehicleNetWeight)} กก.`],
      ["น้ำหนัก REX ที่จอง", `${formatExportVehicleWeighBillNumber(details.reservedRubberWeight)} กก.`],
      ["น้ำหนักคงเหลือบนรถ", `${formatExportVehicleWeighBillNumber(details.remainingWeight)} กก.`],
    ] as const,
    lines: details.lines.map((line) => ({
      ...line,
      carrierNameText: line.carrierName?.trim() || MISSING_VALUE,
      inboundAtText: formatExportVehicleWeighBillDateTime(line.inboundAt),
      outboundAtText: formatExportVehicleWeighBillDateTime(line.outboundAt),
      inboundWeightText: formatExportVehicleWeighBillNumber(line.inboundWeight),
      outboundWeightText: formatExportVehicleWeighBillNumber(line.outboundWeight),
      netWeightText: formatExportVehicleWeighBillNumber(line.netWeight),
    })),
    rubberExports: details.rubberExports.map((rubberExport) => ({
      ...rubberExport,
      currentWeightText: formatExportVehicleWeighBillNumber(rubberExport.currentWeight),
    })),
  };
}
