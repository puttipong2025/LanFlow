import { expect, test } from "@playwright/test";
import { parseBranchThresholdCheck, validDiscrepancyThreshold, type ThresholdCandidate } from "../../src/lib/lanflow/branch-threshold-alert";
import { countAlertGroups } from "../../src/lib/lanflow/count-alert-groups";
import type { CashCountLockState } from "../../src/lib/cash-count-lock";
import { loadSourceModule } from "../helpers/load-source-module";
const id = "cc270000-0000-4000-8000-000000000011";
const candidate: ThresholdCandidate = { kind: "count", locationId: id, locationName: "A", groupId: id, groupOrder: 1, value: 2, threshold: 1, calculatedAt: "2026-10-27T00:00:00Z", discrepancyThreshold: 100, discrepancy: { countId: id, amount: -500, countedAt: "2026-10-26T00:00:00Z" } };
test("one count candidate retains both reasons and old payload remains readable", () => {
  const payload = { config: { thresholdKg: 10000, intervalMinutes: 60 }, configuredCount: 1, checkedCount: 1, unavailable: [], candidates: [candidate] };
  expect(parseBranchThresholdCheck(payload)?.candidates).toHaveLength(1);
  const { discrepancy, discrepancyThreshold, ...old } = candidate;
  expect(discrepancy).toBeTruthy(); expect(discrepancyThreshold).toBe(100);
  expect(parseBranchThresholdCheck({ ...payload, candidates: [old] })).not.toBeNull();
  for (const detail of [{ ...candidate.discrepancy, amount: 100 }, { ...candidate.discrepancy, countedAt: "bad" }, { ...candidate.discrepancy, amount: null }]) {
    expect(parseBranchThresholdCheck({ ...payload, candidates: [{ ...candidate, discrepancy: detail }] })).toBeNull();
  }
});
test("threshold bounds preserve zero, exact cents and reject invalid input", () => {
  for (const value of [0, 0.01, 100, 9999999999.99]) expect(validDiscrepancyThreshold(value)).toBe(true);
  for (const value of [null, "0", -1, 0.001, Infinity, NaN, 10000000000]) expect(validDiscrepancyThreshold(value)).toBe(false);
});
test("lock and count reasons merge without losing group threshold or creating duplicate rows", () => {
  const lock: CashCountLockState = { locationId: id, locationName: "A", groupId: id, enabled: true, locked: true, dueDate: "2026-10-20", lockAt: null, unlockedUntil: null, unlockedAt: null, unlockedByName: null, canUnlock: true, contacts: [] };
  const groups = countAlertGroups([candidate], [lock], Date.now());
  expect(groups).toHaveLength(1); expect(groups[0].rows).toHaveLength(1);
  expect(groups[0].discrepancyThreshold).toBe(100);
  expect(groups[0].rows[0]).toMatchObject({ candidate, lock });
  expect(countAlertGroups([], [lock], Date.now())[0].rows[0].lock).toEqual(lock);
});
test("group route differentiates omitted, null, zero and rejects invalid discrepancy values", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const route = loadSourceModule<{ POST: (r: Request) => Promise<Response> }>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { rpc: async (_name: string, args: Record<string, unknown>) => { calls.push(args); return { data: { id }, error: null }; } } }) },
  });
  const send = (patch: Record<string, unknown>) => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ locationIds: [id], dueDays: 1, ...patch }) }));
  for (const patch of [{}, { discrepancyThreshold: null }, { discrepancyThreshold: 0 }, { discrepancyThreshold: 100.01 }]) expect((await send(patch)).status).toBe(200);
  expect(calls[0]).not.toHaveProperty("p_update_discrepancy_threshold");
  expect(calls[1]).toMatchObject({ p_update_discrepancy_threshold: true, p_discrepancy_threshold: null });
  expect(calls[2]).toMatchObject({ p_update_discrepancy_threshold: true, p_discrepancy_threshold: 0 });
  for (const value of [-1, 1.001, "100", 10000000000, false]) expect((await send({ discrepancyThreshold: value })).status).toBe(400);
  expect(calls).toHaveLength(4);
});
test("separately refreshed alert and lock snapshots never mix different groups in one row", () => {
  const lock: CashCountLockState = { locationId: id, locationName: "A", groupId: "cc270000-0000-4000-8000-000000000099", enabled: true, locked: true, dueDate: "2026-10-20", lockAt: null, unlockedUntil: null, unlockedAt: null, unlockedByName: null, canUnlock: true, contacts: [] };
  const groups = countAlertGroups([candidate], [lock], Date.now());
  expect(groups).toHaveLength(1);
  expect(groups[0].id).toBe(candidate.groupId);
  expect(groups[0].rows[0].candidate).toEqual(candidate);
  expect(groups[0].rows[0].lock).toBeUndefined();
});
