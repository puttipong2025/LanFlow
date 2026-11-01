import type { IncomeExpense } from "@/types";
import { getSyncDb, INCOME_HISTORY_STORE } from "@/lib/idb-core";
import { isIncomeExpenseHistoryRow } from "./contracts";
import { mergeIncomeExpenseLocalEvents } from "./operational-list";

export const INCOME_HISTORY_LIMIT = 100;
export type IncomeExpenseHistory = {
  key: string;
  version: 1;
  ownerUserId: string;
  locationId: string;
  generation: number;
  updatedAt: string | null;
  rows: IncomeExpense[];
};

const keyFor = (owner: string, branch: string) => JSON.stringify([owner, branch.toLowerCase()]);

function validHistory(value: unknown, owner: string, branch: string): value is IncomeExpenseHistory {
  if (!value || typeof value !== "object") return false;
  const row = value as IncomeExpenseHistory;
  return row.version === 1 && row.key === keyFor(owner, branch)
    && row.ownerUserId === owner && row.locationId === branch
    && Number.isSafeInteger(row.generation) && row.generation >= 0
    && (row.updatedAt === null || (typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt))))
    && Array.isArray(row.rows) && row.rows.length <= INCOME_HISTORY_LIMIT
    && row.rows.every((item) => isIncomeExpenseHistoryRow(item, branch))
    && new Set(row.rows.map((item) => item.clientTempId)).size === row.rows.length;
}

/** Optional read copies never decide whether an outbox item is accepted or removed. */
export async function readIncomeExpenseHistory(owner: string, locationId: string): Promise<IncomeExpenseHistory | null> {
  if (!owner || !locationId) return null;
  const branch = locationId.toLowerCase();
  let db: IDBDatabase | undefined;
  try {
    db = await getSyncDb();
    return await new Promise((resolve, reject) => {
      const request = db!.transaction(INCOME_HISTORY_STORE).objectStore(INCOME_HISTORY_STORE).get(keyFor(owner, branch));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        try { resolve(validHistory(request.result, owner, branch) ? request.result : null); }
        catch { resolve(null); }
      };
    });
  } catch { return null; } finally { db?.close(); }
}

async function mutateHistory(owner: string, locationId: string,
  update: (current: IncomeExpenseHistory) => IncomeExpenseHistory | null): Promise<IncomeExpenseHistory | null> {
  if (!owner || !locationId) return null;
  const branch = locationId.toLowerCase();
  let db: IDBDatabase | undefined;
  try {
    db = await getSyncDb();
    return await new Promise((resolve, reject) => {
      const tx = db!.transaction(INCOME_HISTORY_STORE, "readwrite");
      const store = tx.objectStore(INCOME_HISTORY_STORE);
      const request = store.get(keyFor(owner, branch));
      let result: IncomeExpenseHistory | null = null;
      request.onsuccess = () => {
        try {
          const current = validHistory(request.result, owner, branch) ? request.result : {
            key: keyFor(owner, branch), version: 1 as const, ownerUserId: owner, locationId: branch,
            generation: 0, updatedAt: null, rows: [],
          };
          result = update(current);
          if (result) store.put(result);
        } catch (error) { reject(error); tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { return null; } finally { db?.close(); }
}

// Reserve a ticket before fetching. A newer request or local acknowledgement
// invalidates it, preventing a late page from resurrecting a deleted/older row.
export async function startIncomeExpenseHistoryRefresh(owner: string, branch: string) {
  const history = await mutateHistory(owner, branch, (current) => ({ ...current, generation: current.generation + 1 }));
  return history?.generation ?? null;
}

export async function saveIncomeExpenseHistoryPage(owner: string, branch: string, generation: number | null,
  rows: IncomeExpense[]) {
  if (generation === null) return null;
  const summaries = rows.filter((row) => row.syncStatus === "synced").map((row) => {
    const summary = { ...row }; delete summary.saleLines; return summary;
  });
  if (!summaries.every((row) => isIncomeExpenseHistoryRow(row, branch.toLowerCase()))) return null;
  return mutateHistory(owner, branch, (current) => current.generation !== generation ? null : {
    ...current, updatedAt: new Date().toISOString(),
    rows: mergeIncomeExpenseLocalEvents(summaries, [], "").slice(0, INCOME_HISTORY_LIMIT),
  });
}

/** A confirmed mutation patches only its own account/branch copy. */
export function patchIncomeExpenseHistory(owner: string, branch: string, clientTempId: string, row?: IncomeExpense) {
  const summary = row && isIncomeExpenseHistoryRow({ ...row, saleLines: undefined }, branch.toLowerCase())
    ? { ...row, saleLines: undefined } : undefined;
  return mutateHistory(owner, branch, (current) => {
    const previous = current.rows.find((item) => item.clientTempId === clientTempId);
    const confirmed = summary && previous && previous.revisionNo > summary.revisionNo ? previous : summary;
    return {
      ...current, generation: current.generation + 1, updatedAt: new Date().toISOString(),
      rows: mergeIncomeExpenseLocalEvents([
        ...current.rows.filter((item) => item.clientTempId !== clientTempId), ...(confirmed ? [confirmed] : []),
      ], [], "").slice(0, INCOME_HISTORY_LIMIT),
    };
  });
}
