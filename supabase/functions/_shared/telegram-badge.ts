export const TELEGRAM_BADGE_KEYS = [
  "rubber_bill_approval_pending",
  "income_expense_approval_pending",
  "cash_transfer_pending_receipt",
  "stock_approval_pending",
  "money_transfer_pending",
  "money_transfer_partial",
  "money_transfer_advance",
  "time_tracking_approval_pending",
  "rubber_export_draft",
] as const;

export type TelegramBadgeKey = (typeof TELEGRAM_BADGE_KEYS)[number];

export type TelegramBadgeCatalogItem = {
  key: TelegramBadgeKey;
  moduleLabel: string;
  statusLabel: string;
  sortOrder: number;
};

export type TelegramBadgeCount = TelegramBadgeCatalogItem & {
  locationId: string | null;
  locationName: string | null;
  count: number;
};

export type TelegramBadgeConfig = {
  enabled: boolean;
  chatId: string;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  enabledBadgeKeys: TelegramBadgeKey[];
  evidenceEnabled: boolean;
  evidenceIntervalMinutes: number;
  tokenConfigured: boolean;
  catalog: TelegramBadgeCatalogItem[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

export type WeightEvidenceDigestBill = {
  locationId: string;
  locationName: string;
  billId: string;
  billRecordedAt: string;
  weighRowCount: number;
  manualCorrectionCount?: number;
  digestKind?: "incomplete" | "corrected";
};

export type DashboardTelegramAlert = {
  locationId: string;
  locationName: string;
  key: string;
  label: string;
  currentValue: number;
  minimumValue: number;
  unit: string;
  detail: string;
};

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const TELEGRAM_TEXT_LIMIT = 4096;
const MESSAGE_TARGET_LENGTH = 3800;

function generatedAtLabel(value: Date) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function groupLabel(item: TelegramBadgeCount) {
  return item.locationId ? item.locationName || "ไม่ทราบสาขา" : "ส่วนกลาง";
}

export function formatTelegramBadgeDigest(
  counts: TelegramBadgeCount[],
  generatedAt = new Date(),
) {
  const visible = counts
    .filter((item) => Number.isFinite(item.count) && item.count > 0)
    .sort((left, right) => {
      const leftCentral = left.locationId === null ? 1 : 0;
      const rightCentral = right.locationId === null ? 1 : 0;
      return (
        leftCentral - rightCentral ||
        groupLabel(left).localeCompare(groupLabel(right), "th") ||
        left.sortOrder - right.sortOrder ||
        left.key.localeCompare(right.key)
      );
    });

  if (visible.length === 0) return [];

  const header = `🔔 LanFlow · สรุปงานค้าง\n${generatedAtLabel(generatedAt)}`;
  const sections: string[] = [];
  let currentGroup = "";

  for (const item of visible) {
    const group = groupLabel(item);
    if (group !== currentGroup) {
      sections.push(`\n📍 ${group}`);
      currentGroup = group;
    }
    sections.push(
      `• ${item.moduleLabel} — ${item.statusLabel}: ${item.count.toLocaleString("th-TH")}`,
    );
  }

  const messages: string[] = [];
  let current = header;
  for (const section of sections) {
    const candidate = `${current}\n${section}`;
    if (candidate.length <= MESSAGE_TARGET_LENGTH) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = `${header}\n${section}`;
  }
  messages.push(current);

  if (messages.some((message) => message.length > TELEGRAM_TEXT_LIMIT)) {
    throw new Error("Telegram badge summary contains an oversized line");
  }
  return messages;
}

export function formatDashboardAlertDigest(
  alerts: DashboardTelegramAlert[],
  generatedAt = new Date(),
) {
  const visible = alerts
    .filter(
      (item) =>
        Number.isFinite(item.currentValue) &&
        Number.isFinite(item.minimumValue) &&
        item.currentValue < item.minimumValue,
    )
    .sort(
      (left, right) =>
        left.locationName.localeCompare(right.locationName, "th") ||
        left.label.localeCompare(right.label, "th") ||
        left.key.localeCompare(right.key),
    );
  if (visible.length === 0) return [];

  const header = `⚠️ LanFlow · Dashboard ต่ำกว่าเกณฑ์\n${generatedAtLabel(generatedAt)}`;
  const sections: string[] = [];
  let currentLocation = "";
  for (const item of visible) {
    if (item.locationName !== currentLocation) {
      sections.push(`\n📍 ${item.locationName}`);
      currentLocation = item.locationName;
    }
    sections.push(
      [
        `• ${item.label}`,
        `  ปัจจุบัน ${item.currentValue.toLocaleString("th-TH")} ${item.unit}`,
        `  ขั้นต่ำ ${item.minimumValue.toLocaleString("th-TH")} ${item.unit} · ${item.detail}`,
      ].join("\n"),
    );
  }

  const messages: string[] = [];
  let current = header;
  for (const section of sections) {
    const candidate = `${current}\n${section}`;
    if (candidate.length <= MESSAGE_TARGET_LENGTH) {
      current = candidate;
    } else {
      messages.push(current);
      current = `${header}\n${section}`;
    }
  }
  messages.push(current);
  if (messages.some((message) => message.length > TELEGRAM_TEXT_LIMIT)) {
    throw new Error("Dashboard alert summary contains an oversized line");
  }
  return messages;
}

export function formatWeightEvidenceDigest(
  bills: WeightEvidenceDigestBill[],
  generatedAt = new Date(),
) {
  if (bills.some(
    (item) =>
      !Number.isFinite(item.weighRowCount) ||
      item.weighRowCount <= 0 ||
      !Number.isFinite(Date.parse(item.billRecordedAt)) ||
      (item.digestKind !== undefined && !["incomplete", "corrected"].includes(item.digestKind)) ||
      (item.manualCorrectionCount !== undefined && (
        !Number.isInteger(item.manualCorrectionCount) || item.manualCorrectionCount < 0
      )) ||
      (item.digestKind === "corrected" && (item.manualCorrectionCount ?? 0) <= 0),
  )) {
    throw new Error("Weight evidence digest contains invalid bill data");
  }
  const visible = [...bills].sort(
      (left, right) =>
        left.locationName.localeCompare(right.locationName, "th") ||
        left.locationId.localeCompare(right.locationId) ||
        Date.parse(left.billRecordedAt) - Date.parse(right.billRecordedAt) ||
        left.billId.localeCompare(right.billId),
    );
  if (visible.length === 0) return [];

  const incomplete = visible.filter((item) => (item.digestKind ?? "incomplete") === "incomplete");
  const corrected = visible.filter((item) => item.digestKind === "corrected");
  const totalRows = incomplete.reduce((sum, item) => sum + item.weighRowCount, 0);
  const totalCorrections = corrected.reduce((sum, item) => sum + (item.manualCorrectionCount ?? 0), 0);
  const header = [
    "⚖️ LanFlow · หลักฐานน้ำหนัก",
    generatedAtLabel(generatedAt),
    ...(totalRows > 0
      ? [`ยังไม่ส่งหลักฐานครบทั้งหมด ${totalRows.toLocaleString("th-TH")} รายการ`]
      : []),
    ...(totalCorrections > 0
      ? [`แก้น้ำหนักรูปจอด้วยมือทั้งหมด ${totalCorrections.toLocaleString("th-TH")} จุด`]
      : []),
  ].join("\n");
  const timeFormatter = new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
  });
  const messages: string[] = [];
  let current = header;
  for (const [kind, kindBills] of [
    ["incomplete", incomplete],
    ["corrected", corrected],
  ] as const) {
    if (kindBills.length === 0) continue;
    const kindHeading = kind === "corrected" ? "⚠️ บิลแก้น้ำหนักรูปจอด้วยมือ" : null;
    if (kindHeading) current = `${current}\n\n${kindHeading}`;
    const groups = new Map<string, WeightEvidenceDigestBill[]>();
    for (const item of kindBills) {
      const key = `${item.locationId}\u0000${item.locationName}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const group of groups.values()) {
      const branchTotal = group.reduce(
        (sum, item) => sum + (kind === "corrected" ? item.manualCorrectionCount ?? 0 : item.weighRowCount),
        0,
      );
      const unit = kind === "corrected" ? "จุด" : "รายการ";
      const branchHeader = `📍 ${group[0].locationName} — ${branchTotal.toLocaleString("th-TH")} ${unit}`;
      let branchHeaderAdded = false;
      for (const item of group) {
        const time = timeFormatter.format(new Date(item.billRecordedAt));
        const count = kind === "corrected" ? item.manualCorrectionCount ?? 0 : item.weighRowCount;
        const line = `• ${time} — ${count.toLocaleString("th-TH")} ${unit}`;
        const addition = branchHeaderAdded ? line : `${branchHeader}\n${line}`;
        const candidate = `${current}\n${branchHeaderAdded ? "" : "\n"}${addition}`;
        if (candidate.length <= MESSAGE_TARGET_LENGTH) {
          current = candidate;
          branchHeaderAdded = true;
        } else {
          messages.push(current);
          current = `${header}${kindHeading ? `\n\n${kindHeading}` : ""}\n\n${branchHeader}\n${line}`;
          branchHeaderAdded = true;
        }
      }
    }
  }
  messages.push(current);
  if (messages.some((message) => message.length > TELEGRAM_TEXT_LIMIT)) {
    throw new Error("Weight evidence summary contains an oversized line");
  }
  return messages;
}

export function isTelegramBadgeKey(value: string): value is TelegramBadgeKey {
  return (TELEGRAM_BADGE_KEYS as readonly string[]).includes(value);
}
