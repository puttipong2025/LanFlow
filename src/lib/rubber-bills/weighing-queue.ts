import { bangkokDateString } from "@/lib/bangkok-date";
import type { PaymentResponsibility } from "@/types";

export const CUSTOMER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const QUEUE_STORAGE_VERSION = 1;
const CUSTOMER_CACHE_VERSION = 1;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const THAI_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const THAI_TIME_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type WeighingQueueCustomer = {
  id: string;
  mainName: string;
  legacyMemberId: string | null;
  class?: PaymentResponsibility;
  farmAddress?: string | null;
};

export type WeighingQueuePrintSnapshot = {
  queueNumber: number;
  weighingTime: string;
  printedAt: string;
};

export type WeighingQueueItem = {
  id: string;
  customerId: string | null;
  customerName: string;
  createdAt: string;
  printSnapshot: WeighingQueuePrintSnapshot | null;
};

export type DailyWeighingQueue = {
  version: 1;
  date: string;
  weighingTime: string | null;
  items: WeighingQueueItem[];
};

export type WeighingQueueTicket = {
  queueNumber: number;
  customerName: string;
  weighingTime: string;
  printedDate: string;
  printedTime: string;
};

type CustomerCache = {
  version: 1;
  cachedAt: string;
  customers: WeighingQueueCustomer[];
};

function queueStorageKey(deviceId: string, locationId: string) {
  return `lanflow:weighing-queue:v1:${deviceId}:${locationId}`;
}

function customerCacheStorageKey(deviceId: string) {
  return `lanflow:weighing-queue-customers:v1:${deviceId}`;
}

function getBrowserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function createEmptyDailyQueue(now = new Date()): DailyWeighingQueue {
  return {
    version: QUEUE_STORAGE_VERSION,
    date: bangkokDateString(now),
    weighingTime: null,
    items: [],
  };
}

export function isValidWeighingTime(value: string) {
  return TIME_PATTERN.test(value);
}

export function isQueueForCurrentBangkokDay(queue: DailyWeighingQueue, now = new Date()) {
  return queue.date === bangkokDateString(now);
}

export function loadDailyWeighingQueue(
  deviceId: string,
  locationId: string,
  now = new Date(),
  storage = getBrowserStorage(),
): DailyWeighingQueue {
  const empty = createEmptyDailyQueue(now);
  if (!storage) return empty;

  try {
    const raw = storage.getItem(queueStorageKey(deviceId, locationId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<DailyWeighingQueue>;
    if (
      parsed.version !== QUEUE_STORAGE_VERSION
      || parsed.date !== empty.date
      || !Array.isArray(parsed.items)
      || (parsed.weighingTime !== null && (typeof parsed.weighingTime !== "string" || !TIME_PATTERN.test(parsed.weighingTime)))
    ) {
      storage.setItem(queueStorageKey(deviceId, locationId), JSON.stringify(empty));
      return empty;
    }

    const items = parsed.items.filter((item): item is WeighingQueueItem => (
      typeof item?.id === "string"
      && typeof item.customerName === "string"
      && typeof item.createdAt === "string"
      && (item.customerId === null || typeof item.customerId === "string")
      && (
        item.printSnapshot === null
        || (
          typeof item.printSnapshot?.queueNumber === "number"
          && typeof item.printSnapshot.weighingTime === "string"
          && typeof item.printSnapshot.printedAt === "string"
        )
      )
    ));

    return {
      version: QUEUE_STORAGE_VERSION,
      date: parsed.date,
      weighingTime: parsed.weighingTime ?? null,
      items,
    };
  } catch {
    return empty;
  }
}

export function saveDailyWeighingQueue(
  deviceId: string,
  locationId: string,
  queue: DailyWeighingQueue,
  storage = getBrowserStorage(),
) {
  if (!storage) throw new Error("อุปกรณ์นี้ไม่รองรับการบันทึกคิว");
  storage.setItem(queueStorageKey(deviceId, locationId), JSON.stringify(queue));
}

export function saveCustomerCache(
  deviceId: string,
  customers: WeighingQueueCustomer[],
  cachedAt = new Date(),
  storage = getBrowserStorage(),
) {
  if (!storage) return;
  const cache: CustomerCache = {
    version: CUSTOMER_CACHE_VERSION,
    cachedAt: cachedAt.toISOString(),
    customers,
  };
  storage.setItem(customerCacheStorageKey(deviceId), JSON.stringify(cache));
}

export function loadCustomerCache(
  deviceId: string,
  now = new Date(),
  storage = getBrowserStorage(),
): WeighingQueueCustomer[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(customerCacheStorageKey(deviceId));
    if (!raw) return [];
    const cache = JSON.parse(raw) as Partial<CustomerCache>;
    const cachedAt = new Date(cache.cachedAt ?? "").getTime();
    if (
      cache.version !== CUSTOMER_CACHE_VERSION
      || !Number.isFinite(cachedAt)
      || now.getTime() - cachedAt > CUSTOMER_CACHE_MAX_AGE_MS
      || !Array.isArray(cache.customers)
    ) {
      storage.removeItem(customerCacheStorageKey(deviceId));
      return [];
    }

    return cache.customers.filter((customer): customer is WeighingQueueCustomer => (
      typeof customer?.id === "string"
      && typeof customer.mainName === "string"
      && (customer.legacyMemberId === null || typeof customer.legacyMemberId === "string")
      && (
        customer.class === undefined
        || customer.class === "สาขานี้จ่าย"
        || customer.class === "สาขาใหญ่จ่าย"
      )
      && (
        customer.farmAddress === undefined
        || customer.farmAddress === null
        || typeof customer.farmAddress === "string"
      )
    ));
  } catch {
    return [];
  }
}

export function moveQueueItem(items: WeighingQueueItem[], draggedId: string, targetId: string) {
  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;

  const next = [...items];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, dragged);
  return next;
}

export function removeQueueItem(items: WeighingQueueItem[], itemId: string) {
  return items.filter((item) => item.id !== itemId);
}

export function hasQueueItemChangedSincePrint(
  item: WeighingQueueItem,
  queueNumber: number,
  weighingTime: string,
) {
  return Boolean(
    item.printSnapshot
    && (
      item.printSnapshot.queueNumber !== queueNumber
      || item.printSnapshot.weighingTime !== weighingTime
    )
  );
}

export function markQueueItemPrinted(
  items: WeighingQueueItem[],
  itemId: string,
  queueNumber: number,
  weighingTime: string,
  printedAt: Date,
) {
  return items.map((item) => item.id === itemId
    ? {
        ...item,
        printSnapshot: {
          queueNumber,
          weighingTime,
          printedAt: printedAt.toISOString(),
        },
      }
    : item);
}

export function buildWeighingQueueTicket(
  item: WeighingQueueItem,
  queueNumber: number,
  weighingTime: string,
  printedAt = new Date(),
): WeighingQueueTicket {
  if (!Number.isInteger(queueNumber) || queueNumber < 1) throw new Error("เลขคิวไม่ถูกต้อง");
  if (!TIME_PATTERN.test(weighingTime)) throw new Error("เวลาชั่งไม่ถูกต้อง");

  return {
    queueNumber,
    customerName: item.customerName,
    weighingTime,
    printedDate: THAI_DATE_FORMATTER.format(printedAt),
    printedTime: THAI_TIME_FORMATTER.format(printedAt),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderWeighingQueueTicketHtml(ticket: WeighingQueueTicket) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บัตรคิว ${ticket.queueNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 74mm;
      color: #000;
      font-family: Arial, "Noto Sans Thai", sans-serif;
      text-align: center;
    }
    .title { font-size: 15px; font-weight: 800; }
    .queue-number {
      margin: 2mm 0;
      font-size: 54px;
      line-height: 1;
      font-weight: 900;
    }
    .customer {
      padding: 2.5mm 0;
      border-block: 1px dashed #000;
      font-size: 17px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .weighing-label { margin-top: 3mm; font-size: 13px; font-weight: 700; }
    .weighing-time {
      margin-top: 1mm;
      font-size: 30px;
      line-height: 1.1;
      font-weight: 900;
      white-space: nowrap;
    }
    .printed-at { margin-top: 4mm; font-size: 11px; }
  </style>
</head>
<body>
  <div class="title">บัตรคิว</div>
  <div class="queue-number">${String(ticket.queueNumber).padStart(2, "0")}</div>
  <div class="customer">${escapeHtml(ticket.customerName)}</div>
  <div class="weighing-label">เวลาชั่ง</div>
  <div class="weighing-time">${ticket.weighingTime} น.</div>
  <div class="printed-at">ออกบัตร ${ticket.printedDate} เวลา ${ticket.printedTime} น.</div>
</body>
</html>`;
}
