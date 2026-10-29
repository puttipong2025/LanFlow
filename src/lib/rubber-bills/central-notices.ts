import type { RubberQueueRow } from "./central-queue-contract";

const storageKey = (owner: string, location: string) => `lanflow:rubber-central-notices:${owner}:${location}`;
export const rubberQueueNoticeKey = (row: Pick<RubberQueueRow, "commandId" | "errorCode">) => `${row.commandId}:${row.errorCode}`;

// Only acknowledgement keys are local. Rejected business proposals are not
// retained to display warnings; their minimal authoritative receipt is central.
export function loadRubberQueueNoticeAcks(owner: string, location: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(owner, location)) ?? "[]");
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string").slice(-100) : [];
  } catch { return []; }
}

export function acknowledgeRubberQueueNotice(owner: string, location: string, keys: string[], key: string) {
  const next = [...keys.filter(value => value !== key), key].slice(-100);
  try { window.localStorage.setItem(storageKey(owner, location), JSON.stringify(next)); } catch { /* Inline state still dismisses this session. */ }
  return next;
}
