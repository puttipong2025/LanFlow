import type { RubberExportDetails } from "@/types/rubber-exports";
import { calculatePurchaseCostIncludingWork } from "@/lib/rubber-exports/calculations";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const MISSING_VALUE = "—";

export function formatRubberExportNumber(value: number | null | undefined) {
  if (value == null) return MISSING_VALUE;
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRubberExportDate(value: string | null | undefined) {
  if (!value) return MISSING_VALUE;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(`${value}T00:00:00+07:00`));
}

export function formatRubberExportDateTime(value: string | null | undefined) {
  if (!value) return MISSING_VALUE;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(value));
}

export function formatRubberAge(value: number | null | undefined) {
  if (value == null) return MISSING_VALUE;
  const roundedHours = Math.round(value);
  const days = Math.floor(roundedHours / 24);
  const hours = roundedHours % 24;
  return `${days} วัน ${hours} ชั่วโมง (${(value / 24).toFixed(2)} วัน)`;
}

function ageSummaryText(
  value: number | null | undefined,
  estimatedCount: number | null | undefined,
) {
  const formatted = formatRubberAge(value);
  if (formatted === MISSING_VALUE || !estimatedCount) return formatted;
  return `${formatted} · ประมาณการ ${estimatedCount.toLocaleString("th-TH")} บิล`;
}

function formatBangkokFileTimestamp(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: BANGKOK_TIME_ZONE,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}`;
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "rubber-export";
}

export function rubberExportPdfFilename(details: RubberExportDetails) {
  return `LanFlow-rubber-export-${sanitizeFilenamePart(details.exportNo)}-${formatBangkokFileTimestamp(details.createdAt)}-A4-landscape.pdf`;
}

export function rubberExportShareTitle(details: RubberExportDetails) {
  return `รายการส่งออกยาง ${details.exportNo} · ${details.locationName} · ${formatRubberExportDateTime(details.createdAt)}`;
}

export function rubberExportStatusLabel(details: RubberExportDetails) {
  return details.status === "verified" ? "ตรวจสอบแล้ว" : "ฉบับร่าง";
}

export function buildRubberExportPresentation(details: RubberExportDetails) {
  const purchaseCost = calculatePurchaseCostIncludingWork(
    details.rubberValueTotal,
    details.workTotal,
    details.currentWeight,
    details.originalWeightTotal,
  );
  return {
    status: rubberExportStatusLabel(details),
    summary: [
      ["น้ำหนักสุทธิรวม", `${formatRubberExportNumber(details.originalWeightTotal)} กก.`],
      ["ต้นทุนซื้อเฉลี่ย", `฿${formatRubberExportNumber(details.averagePrice)}/กก.`],
      ["ต้นทุนซื้อรวมค่าทำงาน", purchaseCost.total === null
        ? MISSING_VALUE
        : `฿${formatRubberExportNumber(purchaseCost.total)}`],
      ["ต้นทุนซื้อเฉลี่ยรวมค่าทำงาน", purchaseCost.average === null
        ? MISSING_VALUE
        : `฿${formatRubberExportNumber(purchaseCost.average)}/กก.`],
      ["น้ำหนักปัจจุบัน", details.currentWeight == null
        ? MISSING_VALUE
        : `${formatRubberExportNumber(details.currentWeight)} กก.`],
      ["น้ำหนักหาย", details.weightLossPercent == null
        ? MISSING_VALUE
        : `${formatRubberExportNumber(details.weightLossPercent)}%`],
      ["ค่าทำงานต่อกิโลกรัม", details.workRate == null
        ? MISSING_VALUE
        : `฿${formatRubberExportNumber(details.workRate)}`],
      ["ค่าดำเนินการอื่น", `฿${formatRubberExportNumber(details.otherOperatingCost)}`],
      ["ยอดค่าทำงานรวม", details.workTotal == null
        ? MISSING_VALUE
        : `฿${formatRubberExportNumber(details.workTotal)}`],
      ["อายุเฉลี่ยถ่วงน้ำหนัก", ageSummaryText(details.averageAgeHours, details.estimatedAgeItemCount)],
      ["อายุมากที่สุด", ageSummaryText(details.oldestAgeHours, details.estimatedAgeItemCount)],
    ] as const,
    items: details.items.map((item) => ({
      ...item,
      billDateText: formatRubberExportDate(item.billDate),
      eligibilityAtText: formatRubberExportDateTime(item.eligibilityAt),
      netWeightText: formatRubberExportNumber(item.netWeight),
      paidAmountText: formatRubberExportNumber(item.paidAmount),
      ageText: item.ageHours == null
        ? MISSING_VALUE
        : `${formatRubberAge(item.ageHours)}${item.ageIsEstimated ? " · ประมาณการ" : ""}`,
    })),
    audit: {
      created: `${details.createdByName || MISSING_VALUE}\n${formatRubberExportDateTime(details.createdAt)}`,
      verified: `${details.verifiedByName || MISSING_VALUE}\n${formatRubberExportDateTime(details.verifiedAt)}`,
    },
  };
}
