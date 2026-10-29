import type { RubberBill } from "@/types";

type Scope = { owner: string; location: string; print: (bill: RubberBill, current: () => boolean) => Promise<void>; isBusy: () => boolean };
let scope: Scope | undefined;
let printing = Promise.resolve();

export function printAcceptedRubberReceipt(owner: string, location: string, bill: RubberBill) {
  const origin = scope;
  if (!origin || origin.owner !== owner || origin.location !== location || bill.netTotal <= 0) return;
  const snapshot = JSON.parse(JSON.stringify(bill)) as RubberBill;
  const current = () => scope === origin;
  printing = printing.then(async () => {
    while (current() && origin.isBusy()) await new Promise(resolve => setTimeout(resolve, 50));
    if (current()) await origin.print(snapshot, current);
  }).catch(() => {});
}

// Tab-local intents deliberately disappear on navigation/reload. Neither another
// device nor returning to this branch starts retrospective automatic printing.
export function registerRubberQueuePrinter(owner: string, location: string, print: Scope["print"], isBusy: Scope["isBusy"] = () => false) {
  const registered = { owner, location, print, isBusy };
  scope = registered;
  return () => {
    if (scope === registered) scope = undefined;
  };
}
