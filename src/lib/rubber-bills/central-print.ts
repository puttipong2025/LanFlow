import type { RubberBill } from "@/types";
import type { SyncEvent } from "@/lib/idb-queue";

type Scope = { owner: string; location: string; print: (bill: RubberBill, current: () => boolean) => Promise<void>; isBusy: () => boolean };
let scope: Scope | undefined;
const intents = new Map<string, { bill: RubberBill; scope: Scope }>();
let printing = Promise.resolve();

// Tab-local intents deliberately disappear on navigation/reload. Neither another
// device nor returning to this branch starts retrospective automatic printing.
export function registerRubberQueuePrinter(owner: string, location: string, print: Scope["print"], isBusy: Scope["isBusy"] = () => false) {
  const registered = { owner, location, print, isBusy };
  scope = registered;
  return () => {
    if (scope === registered) scope = undefined;
    for (const [key, intent] of intents) if (intent.scope === registered) intents.delete(key);
  };
}

export function rememberRubberQueuePrint(event: SyncEvent, bill: RubberBill) {
  if (navigator.onLine && event.operation === "create" && scope?.owner === event.ownerUserId
    && scope.location === event.locationId && bill.netTotal > 0) {
    intents.set(event.payload.commandId, { bill, scope });
  }
}

export function completeRubberQueuePrint(commandId: string, result: Record<string, unknown>) {
  const intent = intents.get(commandId);
  intents.delete(commandId);
  if (!intent || result.status !== "synced" || scope !== intent.scope) return;
  const current = () => scope === intent.scope;
  const bill = { ...intent.bill, id: String(result.id), billNo: String(result.serverBillNo),
    serverBillNo: String(result.serverBillNo), revisionNo: Number(result.revisionNo),
    serverReceivedAt: String(result.serverReceivedAt), syncStatus: "synced" as const,
    serverSubmissionAttempted: false, approvalPending: false };
  printing = printing.then(async () => {
    while (current() && intent.scope.isBusy()) await new Promise(resolve => setTimeout(resolve, 50));
    if (current()) await intent.scope.print(bill, current);
  }).catch(() => {});
}
