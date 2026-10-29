import { parseCashCountLocks, type CashCountLockState } from "@/lib/cash-count-lock";

type Snapshot = { scope: string; states: CashCountLockState[]; offset: number };
function key(scope: string) {
  // The last member is selected branch; the Server response contains all granted branches.
  const identity: unknown = JSON.parse(scope);
  if (!Array.isArray(identity) || identity.length !== 5 || typeof identity[0] !== "string") throw new Error("Invalid lock scope");
  return `lanflow:cash-lock:v1:${identity[0]}`;
}
export function saveCashLockSnapshot(snapshot: Snapshot) {
  try { localStorage.setItem(key(snapshot.scope), JSON.stringify({ states: snapshot.states, offset: snapshot.offset, serverNow: new Date().toISOString() })); } catch { /* Optional browser storage. */ }
}
export function loadCashLockSnapshot(scope: string): Snapshot | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key(scope)) ?? "null");
    if (!parseCashCountLocks(stored) || !Number.isFinite(stored.offset)) return null;
    const grants: unknown = JSON.parse(scope)[2];
    if (!Array.isArray(grants) || !grants.every(id => typeof id === "string")) return null;
    return { scope, states: stored.states.filter((state: CashCountLockState) => grants.includes(state.locationId)), offset: stored.offset };
  } catch { return null; }
}
