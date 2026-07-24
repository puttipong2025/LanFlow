export const TELEGRAM_BADGE_KEYS = [
  "rubber_bill_approval_pending",
  "income_expense_approval_pending",
  "cash_transfer_pending_receipt",
  "cash_transfer_mismatched",
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
  tokenConfigured: boolean;
  catalog: TelegramBadgeCatalogItem[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
  updatedByName: string | null;
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

export function isTelegramBadgeKey(value: string): value is TelegramBadgeKey {
  return (TELEGRAM_BADGE_KEYS as readonly string[]).includes(value);
}
