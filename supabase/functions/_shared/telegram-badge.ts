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

export type WeightEvidenceDigestBranch = {
  locationId: string;
  locationName: string;
  totalWeighRows: number;
  manualCorrectionCount: number;
  incompleteWeighRows: number;
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
  branches: WeightEvidenceDigestBranch[],
  generatedAt = new Date(),
) {
  const visible = branches
    .filter(
      (item) =>
        Number.isFinite(item.totalWeighRows) &&
        Number.isFinite(item.manualCorrectionCount) &&
        Number.isFinite(item.incompleteWeighRows) &&
        item.totalWeighRows > 0 &&
        item.manualCorrectionCount >= 0 &&
        item.incompleteWeighRows >= 0,
    )
    .sort(
      (left, right) =>
        right.totalWeighRows - left.totalWeighRows ||
        left.locationName.localeCompare(right.locationName, "th") ||
        left.locationId.localeCompare(right.locationId),
    );
  const manualTotal = visible.reduce(
    (sum, item) => sum + item.manualCorrectionCount,
    0,
  );
  const incompleteTotal = visible.reduce(
    (sum, item) => sum + item.incompleteWeighRows,
    0,
  );
  if (manualTotal === 0 && incompleteTotal === 0) return [];

  const totalRows = visible.reduce((sum, item) => sum + item.totalWeighRows, 0);
  const header = [
    "⚖️ LanFlow · หลักฐานน้ำหนัก",
    generatedAtLabel(generatedAt),
    `รายการชั่งทั้งหมด ${totalRows.toLocaleString("th-TH")}`,
    `แก้ด้วยมือ ${manualTotal.toLocaleString("th-TH")} · หลักฐานยังไม่ครบ ${incompleteTotal.toLocaleString("th-TH")}`,
  ].join("\n");
  const sections = visible.map((item) => [
    `\n📍 ${item.locationName} · ${item.totalWeighRows.toLocaleString("th-TH")} รายการชั่ง`,
    `• แก้ด้วยมือ: ${item.manualCorrectionCount.toLocaleString("th-TH")}`,
    `• หลักฐานยังไม่ครบ: ${item.incompleteWeighRows.toLocaleString("th-TH")}`,
  ].join("\n"));

  const messages: string[] = [];
  let current = header;
  for (const section of sections) {
    const candidate = `${current}\n${section}`;
    if (candidate.length <= MESSAGE_TARGET_LENGTH) current = candidate;
    else {
      messages.push(current);
      current = `${header}\n${section}`;
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
