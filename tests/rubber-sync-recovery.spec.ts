import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { IDBFactory } from "fake-indexeddb";
import * as queue from "../src/lib/idb-queue";
import { enqueueSyncEvent, getPendingEvents, updateSyncEvent, type SyncEvent } from "../src/lib/idb-queue";
import { recordRubberSyncFailure } from "../src/lib/rubber-bills/sync-failure";
import { isConfirmedRubberSyncResult } from "../src/lib/rubber-bills/sync-result";
import { rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import { normalizeRubberBillQueueBeforeSync } from "../src/lib/rubber-bills/normalize-sync-queue";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function retryWith(response: Response) {
  const event = { id: "local", entity: "rubber_bills", operation: "create", status: "failed", payload: { clientTempId: "local", operation: "create", expectedRevisionNo: 0 } };
  let removed = false;
  const hook = loadSourceModule<typeof import("../src/hooks/usePerRecordSyncRetry")>("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: { mutationFn: (args: unknown) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": { getPendingEvents: async () => [event], reconcileSyncEventsIfCurrent: async () => true, updateSyncEventIfCurrent: async () => true, removeSyncEventIfCurrent: async () => { removed = true; return true; } },
    "@/lib/auth-fetch": { authFetch: async () => response },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/rubber-bills/feed-cache": {},
  }, { navigator: { onLine: true } });
  await hook.usePerRecordSyncRetry("location", "owner").retrySyncEvent({ entity: "rubber_bills", id: "local" }).catch(() => {});
  return { event, removed };
}

test("rubber manual retry preserves transient failures for automatic retry", async () => {
  const result = await retryWith(Response.json({ status: "failed", errorMessage: "temporary" }, { status: 503 }));
  expect(result.event.status).toBe("pending");
  expect(result.removed).toBe(false);
});

test("rubber manual retry never removes a queue event for an empty successful response", async () => {
  const result = await retryWith(new Response("", { status: 200 }));
  expect(result.removed).toBe(false);
  expect(result.event.status).toBe("pending");
});

function command(): SyncEvent {
  return { id: "local", entity: "rubber_bills", ownerUserId: "owner", locationId: "location", operation: "update", serverId: "71000000-0000-4000-8000-000000000021", timestamp: 1, status: "pending", payload: { operation: "update", clientTempId: "local", idempotencyKey: "update:local:3", locationId: "location", expectedRevisionNo: 3, items: [] } };
}

async function queued() {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  const event = command();
  event.queueId = await enqueueSyncEvent(event);
  return event;
}

const conflict = { status: "conflict", errorMessage: "ข้อมูลเปลี่ยนแล้ว", resolution: "discard_local", clientTempId: "local", operation: "update" };

test("verified conflict discards only its local command and preserves other scopes", async () => {
  const event = await queued();
  await enqueueSyncEvent({ ...command(), ownerUserId: "other", id: "other" });
  expect(await recordRubberSyncFailure(event, 409, conflict)).toBe("discarded");
  expect(await getPendingEvents(event)).toEqual([]);
  expect(await getPendingEvents({ ...event, ownerUserId: "other" })).toHaveLength(1);
});

test("legacy conflicts and mismatched conflict identities are retained", async () => {
  const event = await queued();
  expect(await recordRubberSyncFailure(event, 409, { ...conflict, clientTempId: "wrong" })).toBe("conflict");
  expect(await getPendingEvents(event)).toHaveLength(1);
});

test("a conflict response cannot discard a command edited in another tab", async () => {
  const event = await queued();
  await updateSyncEvent({ ...event, payload: { ...event.payload, customerName: "changed" } });
  expect(await recordRubberSyncFailure(event, 409, conflict)).toBe("conflict");
  const current = await getPendingEvents(event);
  expect(current).toHaveLength(1);
  expect(current[0].payload.customerName).toBe("changed");
});

test("dependent commands prevent automatic conflict discard", async () => {
  const event = await queued();
  const next = { ...event, operation: "delete" as const, timestamp: 2 };
  delete next.queueId;
  await enqueueSyncEvent(next);
  expect(await recordRubberSyncFailure(event, 409, conflict)).toBe("conflict");
  expect(await getPendingEvents(event)).toHaveLength(2);
});

test("atomic discard detects a dependent command inserted after the original snapshot", async () => {
  const event = await queued();
  const next = { ...event, operation: "delete" as const, timestamp: 2 };
  delete next.queueId;
  await enqueueSyncEvent(next);
  expect(await queue.reconcileSyncEventsIfCurrent([event], undefined, true)).toBe(false);
  expect(await getPendingEvents(event)).toHaveLength(2);
});

test("malformed HTTP 400 cannot unlock an uncertain create for editing", async () => {
  const event = await queued();
  event.operation = "create";
  event.serverSubmissionAttempted = true;
  await updateSyncEvent(event);
  expect(await recordRubberSyncFailure(event, 400, {})).toBe("pending");
  const current = (await getPendingEvents(event))[0];
  expect(current.serverSubmissionAttempted).toBe(true);
  expect(rubberBillFromSyncEvent(current, "owner")?.canCorrectSyncFailure).toBe(false);
});

test("normalization groups a large queue with linear identity reads", async () => {
  let reads = 0;
  const events = Array.from({ length: 128 }, (_, index) => ({ ...command(), get id() { reads++; return `local-${index}`; } }));
  const normalizer = loadSourceModule<typeof import("../src/lib/rubber-bills/normalize-sync-queue")>("src/lib/rubber-bills/normalize-sync-queue.ts", {
    "@/lib/idb-queue": { getPendingEvents: async () => events },
    "@/lib/coalesceQueueGroup": {},
  });
  await normalizer.normalizeRubberBillQueueBeforeSync("owner", "location");
  expect(reads).toBeLessThan(128 * 12);
});

test("an actionable rejection still allows correction after malformed-response protection", async () => {
  const event = await queued();
  event.serverSubmissionAttempted = true;
  await updateSyncEvent(event);
  expect(await recordRubberSyncFailure(event, 400, { status: "failed", errorMessage: "น้ำหนักไม่ถูกต้อง" })).toBe("failed");
  const current = (await getPendingEvents(event))[0];
  expect(current.serverSubmissionAttempted).toBe(false);
  expect(rubberBillFromSyncEvent(current, "owner")?.canCorrectSyncFailure).toBe(true);
});

test("coalescing aborts if another tab appends a command after the group was read", async () => {
  const event = await queued();
  const next = { ...event, timestamp: 2 };
  delete next.queueId;
  await enqueueSyncEvent(next);
  const normalizer = loadSourceModule<typeof import("../src/lib/rubber-bills/normalize-sync-queue")>("src/lib/rubber-bills/normalize-sync-queue.ts", {
    "@/lib/idb-queue": { ...queue, getPendingEvents: async () => {
      const snapshot = await getPendingEvents(event);
      await enqueueSyncEvent({ ...next, timestamp: 3 });
      return snapshot;
    } },
  });
  expect(await normalizer.normalizeRubberBillQueueBeforeSync("owner", "location")).toBe(false);
  expect(await getPendingEvents(event)).toHaveLength(3);
});

test("only actionable rejected writes can be corrected; delete and legacy failed stay guarded", () => {
  const event = { ...command(), status: "failed" as const, failureHttpStatus: 400 };
  expect(rubberBillFromSyncEvent(event, "owner")?.canCorrectSyncFailure).toBe(true);
  expect(rubberBillFromSyncEvent({ ...event, operation: "delete" }, "owner")?.canCorrectSyncFailure).toBe(false);
  expect(rubberBillFromSyncEvent({ ...event, failureHttpStatus: undefined }, "owner")?.canCorrectSyncFailure).toBe(false);
  expect(rubberBillFromSyncEvent({ ...event, serverSubmissionAttempted: true }, "owner")?.canCorrectSyncFailure).toBe(false);
});

test("confirmed update requires the expected bill and exact next revision", () => {
  const event = command();
  const result = { status: "synced", id: event.serverId, revisionNo: 4, serverBillNo: "B1", serverReceivedAt: "2026-10-27T00:00:00Z" };
  expect(isConfirmedRubberSyncResult(result, event)).toBe(true);
  expect(isConfirmedRubberSyncResult({ ...result, revisionNo: 5 }, event)).toBe(false);
  expect(isConfirmedRubberSyncResult({ ...result, serverReceivedAt: "October 27, 2026" }, event)).toBe(false);
  expect(isConfirmedRubberSyncResult({ ...result, id: "71000000-0000-4000-8000-000000000022" }, event)).toBe(false);
  expect(isConfirmedRubberSyncResult({ status: "pending_approval", requestId: event.serverId, clientTempId: "wrong", operation: "update" }, event)).toBe(false);
});

test("a rolled-over calendar date cannot acknowledge a queued command", () => {
  const event = command();
  const result = { status: "synced", id: event.serverId, revisionNo: 4, serverBillNo: "B1" };
  for (const serverReceivedAt of ["2026-02-31T00:00:00Z", "2026-02-29T00:00:00Z", "2026-10-27T24:00:00Z", "0000-01-01T00:00:00Z"]) {
    expect(isConfirmedRubberSyncResult({ ...result, serverReceivedAt }, event)).toBe(false);
  }
  expect(isConfirmedRubberSyncResult({ ...result, serverReceivedAt: "2028-02-29T00:00:00Z" }, event)).toBe(true);
});

for (const status of ["pending_approval", "discarded"] as const) {
  test(`manual retry acknowledges ${status} only for its submitted identity`, async () => {
    const result = await retryWith(Response.json({ status, operation: "create", clientTempId: "local", requestId: "71000000-0000-4000-8000-000000000021" }));
    expect(result.removed).toBe(true);
    const wrong = await retryWith(Response.json({ status, operation: "update", clientTempId: "local", requestId: "71000000-0000-4000-8000-000000000021" }));
    expect(wrong.removed).toBe(false);
    expect(wrong.event.status).toBe("pending");
  });
}

test("missing bill outside the readable branch scope cannot authorize automatic discard", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/route")>("src/app/api/lanflow/rubber-bills/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { role: "admin", locationIds: [] }, supabase: {
      from: () => { const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }; return { select: () => query }; },
    } }) },
  });
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills", { method: "POST", body: JSON.stringify({ ...command().payload, locationId: "71000000-0000-4000-8000-000000000022", expectedServerId: command().serverId, priceAdjustmentTarget: 0 }) }));
  expect(response.status).toBe(409);
  expect((await response.json()).resolution).toBeUndefined();
});

for (const { operation, inFlight } of [
  { operation: "create", inFlight: false }, { operation: "update", inFlight: false }, { operation: "create", inFlight: true }, { operation: "update", inFlight: true },
] as const) {
test(`correcting a rejected ${operation} preserves the queued revision and key (in flight: ${inFlight})`, async () => {
  const event = await queued();
  if (operation === "create") {
    event.operation = "create";
    delete event.serverId;
    event.payload = { ...event.payload, operation, expectedRevisionNo: 0, idempotencyKey: "create:local:0" };
  }
  event.status = "failed";
  event.failureHttpStatus = 400;
  event.serverSubmissionAttempted = inFlight;
  await updateSyncEvent(event);
  const bill = rubberBillFromSyncEvent(event, "owner")!;
  expect(bill.revisionNo).toBe(operation === "create" ? 1 : 4);
  const hooks = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: { mutationFn: (args: unknown) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": queue,
    "sonner": { toast: {} },
    "@/lib/auth-fetch": {},
    "@/lib/money-flow/invalidation": {},
    "@/lib/rubber-bills/feed-cache": {},
  }, { navigator: { onLine: true } });
  const saving = hooks.useRubberBillMutations("location", "owner", {
    locationId: "location", groupId: null, ruleSource: "ungrouped", editWindowMinutes: 30,
    centralPrice: 100, priceAllowance: 0, effectivePriceCap: 100, priceRuleRevision: 1, nonCurrentDateRequiresApproval: false,
  }).updateBill({ ...bill, customerName: "corrected" });
  if (inFlight) {
    const failure = await saving.then(() => null, (error: Error) => error.message);
    expect(failure).toContain("กำลังยืนยันผล");
    expect((await getPendingEvents(event))[0].payload.customerName).not.toBe("corrected");
    return;
  }
  await saving;
  const current = (await getPendingEvents(event))[0];
  expect(current.status).toBe("pending");
  expect(current.payload.expectedRevisionNo).toBe(operation === "create" ? 0 : 3);
  expect(current.payload.idempotencyKey).toBe(`${operation}:local:${operation === "create" ? 0 : 3}`);
  expect(current.payload.customerName).toBe("corrected");
});
}

test("simultaneous senders share one network request and independent response bodies", async () => {
  let calls = 0;
  const sender = loadSourceModule<typeof import("../src/lib/rubber-bills/sync-request")>("src/lib/rubber-bills/sync-request.ts", {
    "@/lib/auth-fetch": { authFetch: async () => { calls++; return Response.json({ status: "synced" }); } },
  });
  const event = command();
  const results = await Promise.all([sender.sendRubberBillCommand(event, event.payload), sender.sendRubberBillCommand(event, event.payload)]);
  expect(calls).toBe(1);
  expect(await results[0].json()).toEqual(await results[1].json());
});

test("legacy recovery replays the immutable command without changing its payload", async () => {
  const event = await queued();
  event.status = "failed";
  await updateSyncEvent(event);
  expect(await normalizeRubberBillQueueBeforeSync("owner", "location")).toBe(true);
  const current = (await getPendingEvents(event))[0];
  expect(current.status).toBe("pending");
  expect(current.payload).toEqual(event.payload);
});

test("legacy recovery never coalesces a failed command with dependent changes", async () => {
  const event = await queued();
  event.status = "conflict";
  await updateSyncEvent(event);
  const next = { ...event, operation: "delete" as const, timestamp: 2 };
  delete next.queueId;
  await enqueueSyncEvent(next);
  await normalizeRubberBillQueueBeforeSync("owner", "location");
  const current = await getPendingEvents(event);
  expect(current).toHaveLength(2);
  expect(current.every((entry) => entry.status === "conflict")).toBe(true);
});

for (const status of [401, 408, 425, 429, 500, 503]) {
  test(`transient ${status} preserves command and key for later replay`, async () => {
    const event = await queued();
    const payload = structuredClone(event.payload);
    expect(await recordRubberSyncFailure(event, status, { status: "failed" })).toBe("pending");
    expect((await getPendingEvents(event))[0].payload).toEqual(payload);
  });
}

for (const online of [true, false]) {
  test(`normal feed keeps authoritative values instead of a failed local update (${online ? "online" : "offline"})`, async () => {
    const event = command();
    event.status = "failed";
    event.payload.customerName = "unconfirmed local change";
    const server = { ...rubberBillFromSyncEvent(event, "owner")!, customerName: "authoritative", syncStatus: "synced", serverBillNo: "B1" };
    let queryFn: (context: { pageParam: null; signal: AbortSignal }) => Promise<{ bills: { customerName: string }[] }> = async () => ({ bills: [] });
    const hooks = loadSourceModule<typeof import("../src/hooks/useRubberBillList")>("src/hooks/useRubberBillList.ts", {
      "@tanstack/react-query": { useInfiniteQuery: (options: { queryFn: typeof queryFn }) => { queryFn = options.queryFn; return {}; } },
      "@/components/rubber-bills/bill-display": { buildRubberBillReceiptModel: () => ({}) },
      "@/hooks/useRubberBillEvidenceReview": { mapRubberBillEvidenceState: (row: unknown) => row },
      "@/lib/auth-fetch": { authFetch: async () => Response.json({ rows: [server] }), assertApiResponse: async () => {} },
      "@/lib/idb-queue": { getPendingEvents: async () => [event], getRubberBillReceiptSnapshots: async () => [{ bill: server }], putRubberBillReceiptSnapshots: async () => {}, pruneRubberBillReceiptSnapshots: async () => {} },
      "@/lib/rubber-bills/map-feed-row": { mapRubberBillFeedRow: (row: unknown) => row },
      "@/lib/supabase/client": {},
    }, { navigator: { onLine: online } });
    hooks.useRubberBillList({ ownerUserId: "owner", locationId: "location", mode: "latest", documentStatus: "any", search: "" });
    const result = await queryFn({ pageParam: null, signal: new AbortController().signal });
    expect(result.bills.map((bill) => bill.customerName)).toEqual(["authoritative"]);
  });
}

test("problem rows expose the full cause and enable editing only for correctable rejections", async ({ page }) => {
  const { RubberBillsTable } = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillsTable")>("src/components/rubber-bills/RubberBillsTable.tsx", {});
  const event = { ...command(), status: "failed" as const, failureHttpStatus: 400, errorMessage: "ข้อมูลน้ำหนักไม่ถูกต้อง กรุณาตรวจสอบรายการชั่งก่อนส่งใหม่" };
  const bill = rubberBillFromSyncEvent(event, "owner")!;
  const noop = () => {};
  const props = { bills: [bill], page: 1, pageSize: 10, onPageChange: noop, onView: noop, onEvidence: noop, onEdit: noop, onDelete: noop, onPrint: noop, onRetry: noop, onDiscardLocal: noop, onOpenOcrSourceImage: noop, retryDisabled: false, discardDisabled: false, evidenceStatesByBillId: new Map(), evidenceOnline: true };
  await page.setContent(renderToStaticMarkup(createElement(RubberBillsTable, props)));
  await expect(page.getByRole("button", { name: "แก้ไข", exact: true })).toBeEnabled();
  await expect(page.getByText(event.errorMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ทิ้งรายการค้างในเครื่อง", exact: true })).toBeEnabled();
  await page.setContent(renderToStaticMarkup(createElement(RubberBillsTable, { ...props, bills: [{ ...bill, canCorrectSyncFailure: false }] })));
  await expect(page.getByRole("button", { name: "ทิ้งรายการค้างในเครื่องก่อนแก้ไขหรือลบ", exact: true })).toBeDisabled();
});
