import type { SyncEvent } from "@/lib/idb-queue";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import type { IncomeExpense } from "@/types";

export type IncomeExpenseOperationalMode = "latest" | "pending_approval" | "sync_problems";

export type IncomeExpenseOperationalFeedPage = {
  rows: IncomeExpense[];
  nextCursor: string | null;
  hasMore: boolean;
  pendingApprovalCount: number;
};

export function normalizeIncomeExpenseSearch(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function incomeExpenseFromSyncEvent(event: SyncEvent): IncomeExpense {
  const payload = event.payload as ReturnType<typeof buildIncomeExpensePayload>;
  return {
    id: payload.clientTempId,
    clientTempId: payload.clientTempId,
    localBillNo: payload.localBillNo,
    syncStatus: event.status === "conflict" ? "conflict" : event.status === "failed" ? "failed" : "pending",
    idempotencyKey: payload.idempotencyKey,
    locationId: payload.locationId,
    type: payload.type,
    number: payload.localBillNo,
    txDate: payload.txDate,
    title: payload.title,
    cost: payload.cost,
    billOption: payload.billOption,
    unit: payload.unit ?? undefined,
    price: payload.price ?? undefined,
    saleLineCount: payload.saleLines?.length,
    saleLines: payload.saleLines?.map((line) => ({
      ...line,
      stockProductId: "",
      title: "",
      lineTotal: Math.round((line.quantity * line.unitPrice + Number.EPSILON) * 100) / 100,
    })),
    createdByUserId: payload.createdByUserId ?? "",
    createdByName: payload.createdByName ?? "",
    createdByPhone: payload.createdByPhone ?? "",
    clientCreatedAt: payload.clientCreatedAt,
    clientRecordedAt: payload.clientRecordedAt,
    revisionNo: payload.expectedRevisionNo,
    recordStatus: "active",
    syncErrorMessage: event.errorMessage,
  };
}

function matchesSearch(row: IncomeExpense, normalizedSearch: string) {
  if (!normalizedSearch) return true;
  return [
    row.number,
    row.localBillNo,
    row.serverBillNo,
    row.txDate,
    row.title,
    row.billOption,
    row.createdByName,
    row.createdByPhone,
  ].filter(Boolean).join(" ").toLocaleLowerCase("th-TH").includes(normalizedSearch.toLocaleLowerCase("th-TH"));
}

function clientTempIdForEvent(event: SyncEvent) {
  const payload = event.payload as { clientTempId?: unknown };
  return typeof payload.clientTempId === "string" && payload.clientTempId ? payload.clientTempId : event.id;
}

export function mergeIncomeExpenseLocalEvents(
  serverRows: IncomeExpense[],
  events: SyncEvent[],
  normalizedSearch: string,
) {
  const rows = new Map(serverRows.map((row) => [row.clientTempId, row]));
  for (const event of events) {
    const clientTempId = clientTempIdForEvent(event);
    if (event.operation === "delete") {
      if (event.status === "pending") {
        rows.delete(clientTempId);
      } else {
        const current = rows.get(clientTempId);
        if (current) rows.set(clientTempId, {
          ...current,
          syncStatus: event.status,
          syncErrorMessage: event.errorMessage,
        });
        else rows.set(clientTempId, incomeExpenseFromSyncEvent(event));
      }
      continue;
    }

    const local = incomeExpenseFromSyncEvent(event);
    const current = rows.get(clientTempId);
    rows.set(clientTempId, current ? {
      ...current,
      ...local,
      id: current.id,
      serverBillNo: current.serverBillNo,
      number: current.serverBillNo ?? current.number,
      createdByUserId: current.createdByUserId,
      createdByName: current.createdByName,
      createdByPhone: current.createdByPhone,
      serverReceivedAt: current.serverReceivedAt,
    } : local);
  }

  return [...rows.values()]
    .filter((row) => matchesSearch(row, normalizedSearch))
    .sort((left, right) => right.txDate.localeCompare(left.txDate)
      || right.clientRecordedAt.localeCompare(left.clientRecordedAt)
      || right.clientTempId.localeCompare(left.clientTempId));
}

export function mergeIncomeExpenseOperationalLatestPages(
  pages: ReadonlyArray<Pick<IncomeExpenseOperationalFeedPage, "rows">>,
  events: SyncEvent[],
  normalizedSearch: string,
) {
  return mergeIncomeExpenseLocalEvents(pages.flatMap((page) => page.rows), events, normalizedSearch);
}

export function incomeExpenseSyncProblems(events: SyncEvent[], normalizedSearch = "") {
  const byRecord = new Map<string, SyncEvent[]>();
  for (const event of events) {
    if (event.status !== "failed" && event.status !== "conflict") continue;
    const clientTempId = clientTempIdForEvent(event);
    const recordEvents = byRecord.get(clientTempId) ?? [];
    recordEvents.push(event);
    byRecord.set(clientTempId, recordEvents);
  }

  return [...byRecord.values()]
    .map((recordEvents) => {
      const latest = [...recordEvents].sort((left, right) => right.timestamp - left.timestamp)[0]!;
      return { row: incomeExpenseFromSyncEvent(latest), timestamp: Math.min(...recordEvents.map((event) => event.timestamp)) };
    })
    .sort((left, right) => left.timestamp - right.timestamp || left.row.clientTempId.localeCompare(right.row.clientTempId))
    .map(({ row }) => row)
    .filter((row) => matchesSearch(row, normalizedSearch));
}
