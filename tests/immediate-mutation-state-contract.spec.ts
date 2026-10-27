import { expect, test } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  removeRubberBillApprovalRequestFromPendingFeedCache,
  removeRubberBillFromOperationalFeedCache,
  removeRubberBillFromOperationalFeedCacheByBillId,
} from "@/lib/rubber-bills/feed-cache";
import { loadSourceModule } from "./helpers/load-source-module";

function readSource(path: string) {
  return readFileSync(resolve(path), "utf8");
}

test.describe("immediate mutation state contract", () => {
  test("does not recreate a form draft when reconnect flush races with clear", async () => {
    let releaseWrite: (() => void) | undefined;
    let signalWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const operations: string[] = [];
    const hookModule = loadSourceModule<typeof import("../src/hooks/usePersistentFormDraft")>(
      "src/hooks/usePersistentFormDraft.ts",
      {
        react: {
          useCallback: (callback: unknown) => callback,
          useEffect: () => {},
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
          useState: () => [true, () => {}],
        },
        "@/lib/form-drafts": {
          deleteFormDraft: async () => {
            operations.push("delete");
          },
          readFormDraft: async () => null,
          registerDraftFlusher: () => () => {},
          writeFormDraft: async () => {
            operations.push("write");
            if (operations.filter((operation) => operation === "write").length === 1) {
              signalWriteStarted?.();
              await new Promise<void>((resolve) => {
                releaseWrite = resolve;
              });
            }
          },
        },
      },
    );
    const draft = hookModule.usePersistentFormDraft({
      partition: {
        ownerUserId: "user-1",
        locationId: "location-1",
        formType: "stock-receive",
      },
      enabled: true,
      value: { quantity: 1 },
      onRestore: () => {},
    });

    const firstFlush = draft.flushDraft();
    await writeStarted;
    const clear = draft.clearDraft();
    const reconnectFlush = draft.flushDraft();
    releaseWrite?.();
    await Promise.all([firstFlush, clear, reconnectFlush]);

    expect(operations).toEqual(["write", "delete"]);
  });

  test("can clear a persisted form draft after an earlier write failed", async () => {
    let deleteCalled = false;
    const hookModule = loadSourceModule<typeof import("../src/hooks/usePersistentFormDraft")>(
      "src/hooks/usePersistentFormDraft.ts",
      {
        react: {
          useCallback: (callback: unknown) => callback,
          useEffect: () => {},
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
          useState: () => [true, () => {}],
        },
        "@/lib/form-drafts": {
          deleteFormDraft: async () => {
            deleteCalled = true;
          },
          readFormDraft: async () => null,
          registerDraftFlusher: () => () => {},
          writeFormDraft: async () => {
            throw new Error("write failed");
          },
        },
      },
    );
    const draft = hookModule.usePersistentFormDraft({
      partition: {
        ownerUserId: "user-1",
        locationId: "location-1",
        formType: "stock-receive",
      },
      enabled: true,
      value: { quantity: 1 },
      onRestore: () => {},
    });

    let writeError: unknown;
    try {
      await draft.flushDraft();
    } catch (error) {
      writeError = error;
    }
    expect(String(writeError)).toContain("write failed");

    let clearError: unknown;
    try {
      await draft.clearDraft();
    } catch (error) {
      clearError = error;
    }
    expect(clearError).toBeUndefined();
    expect(deleteCalled).toBe(true);
  });

  test("waits for approval query invalidation before mutateAsync resolves", () => {
    const sources = [
      "src/hooks/useRubberBillApprovals.ts",
      "src/hooks/useRubberApprovalGroups.ts",
      "src/hooks/useStockEntryApprovals.ts",
      "src/hooks/useStockProductApprovals.ts",
      "src/hooks/useAcidProducts.ts",
      "src/hooks/useAcidStock.ts",
    ].map(readSource);

    for (const source of sources) {
      expect(source).not.toContain("void queryClient.invalidateQueries");
    }
    expect(sources[0]).toContain("return Promise.all([");
    expect(sources[1]).toContain("return Promise.all([");
    expect(sources[2]).toContain("onSuccess: (data) => Promise.all([");
    expect(sources[3]).toContain("onSuccess: (data) => Promise.all([");
  });

  test("keeps the direct state handoff for server-confirmed admin mutations", () => {
    const adminModule = readSource("src/components/AdminModule.tsx");
    const adminUsersRoute = readSource("src/app/api/lanflow/admin/users/route.ts");

    expect(adminModule).toContain("setUsers((current) => current.some((user) => user.id === data.user!.id)");
    expect(adminModule).not.toContain("toast.success(\"สร้างบัญชีผู้ใช้แล้ว\");\n      await loadUsers();");
    expect(adminUsersRoute).toContain("isActive: true");
    expect(adminUsersRoute).toContain("canAccessSystemManager: capabilities.canManageSystem");
  });

  test("uses synchronous guards for Admin mutations before React can re-render", () => {
    const adminModule = readSource("src/components/AdminModule.tsx");
    const adminContent = readSource("src/components/admin/AdminContent.tsx");

    expect(adminModule).toContain("confirmedPatchLocksRef");
    expect(adminModule).toContain("confirmedPatchLocksRef.current.has(userId)");
    expect(adminContent).toContain("savingRef.current");
    expect(adminContent).toContain("revealLoadingRef.current");
    expect(adminContent).toContain("const [requestId, setRequestId] = useState(() => crypto.randomUUID())");
    expect(adminContent).not.toContain("requestId: crypto.randomUUID() });");
  });

  test("guards settings, reports, and cash-count mutations synchronously", () => {
    const branchSettings = readSource("src/components/admin/BranchConfirmationSettings.tsx");
    const rubberSettings = readSource("src/components/admin/RubberWeightAlertSettings.tsx");
    const reports = readSource("src/components/reports/ReportsModule.tsx");
    const cashCounts = readSource("src/components/cash-counts/CashCountModule.tsx");

    expect(branchSettings).toContain("savingRef.current");
    expect(rubberSettings).toContain("intervalSavingRef.current");
    expect(rubberSettings).toContain("groupSavingRef.current");
    expect(reports).toContain("createLockRef.current");
    expect(reports).toContain("deleteLocksRef.current.has(report.id)");
    expect(cashCounts).toContain("mutationLockRef.current");
  });

  test("guards document transitions and account updates synchronously", () => {
    const sources = {
      receipt: readSource("src/components/rubber-bills/BranchRubberReceiptModal.tsx"),
      wexForm: readSource("src/components/rubber-bills/ExportVehicleWeighBillFormModal.tsx"),
      wexList: readSource("src/components/rubber-bills/ExportVehicleWeighBillsModal.tsx"),
      exportCreate: readSource("src/components/rubber-exports/RubberExportCreateModal.tsx"),
      exportDetail: readSource("src/components/rubber-exports/RubberExportDetailModal.tsx"),
      exports: readSource("src/components/rubber-exports/RubberExportsModule.tsx"),
      approvals: readSource("src/components/rubber-bills/RubberBillApprovalModal.tsx"),
      account: readSource("src/components/lanflow/AccountActions.tsx"),
    };

    expect(sources.receipt).toContain("submitLockRef.current");
    expect(sources.wexForm).toContain("savingRef.current");
    expect(sources.wexList).toContain("deleteLockRef.current");
    expect(sources.exportCreate).toContain("submitLockRef.current");
    expect(sources.exportDetail).toContain("saveLockRef.current");
    expect(sources.exportDetail).toContain("verifyLockRef.current");
    expect(sources.exports).toContain("deleteLocksRef.current");
    expect(sources.exports).toContain("saleLockRef.current");
    expect(sources.exports).toContain("revertLockRef.current");
    expect(sources.approvals).toContain("requestLocksRef.current");
    expect(sources.account).toContain("savingRef.current");
  });

  test("guards Telegram save and test actions synchronously", () => {
    const source = readSource("src/components/lanflow/TelegramBadgeConfigModal.tsx");

    expect(source).toContain("actionLockRef.current");
    expect(source).toContain("if (actionLockRef.current) return;");
  });

  test("guards time-tracking mutations synchronously", () => {
    const employee = readSource("src/components/time-tracking/employee/EmployeeWorkspace.tsx");
    const attendance = readSource("src/components/time-tracking/employee/employee-attendance-actions.ts");
    const payroll = readSource("src/components/time-tracking/payroll/PayrollModal.tsx");

    expect(employee).toContain("mutationLockRef.current");
    expect(employee).toContain("setMutation,");
    expect(attendance).toContain("setMutation(true)");
    expect(payroll).toContain("mutationLockRef.current");
  });

  test("clears deleted rubber-group caches from the revision-protected input", () => {
    const source = readSource("src/hooks/useRubberApprovalGroups.ts");

    expect(source).toContain(
      "onSuccess: (_data, group) => invalidateLocations(group.locationIds)",
    );
    expect(source).not.toContain(
      "onSuccess: (data) => invalidateLocations(data.releasedLocationIds)",
    );
  });

  test("clears every persisted branch cache when the global central price changes", () => {
    const source = readSource("src/hooks/useRubberApprovalGroups.ts");

    expect(source).toContain("clearAllRubberBillApprovalSettingsCache();");
    expect(source).not.toContain("function policyLocationIds(data: GroupsResponse)");
    expect(source).not.toContain("await invalidateLocations(policyLocationIds(data));");
    expect(source).not.toContain("await invalidateLocations(allLocationIds);");
  });

  test("pins the confirmed central price revision until the mutation is submitted", () => {
    const source = readSource("src/components/rubber-bills/RubberApprovalPolicyPanel.tsx");

    expect(source).toContain(
      '| { kind: "central"; value: number; previousValue: number; expectedRevision: number }',
    );
    expect(source).toContain("expectedRevision: confirmation.expectedRevision");
    expect(source).toContain("confirmation.previousValue.toFixed(2)");
    expect(source).not.toContain(
      "await policy.saveCentralPrice({ centralPrice: confirmation.value, expectedRevision: central.revision });",
    );
  });

  test("reports pending approval only after the server confirms the request", () => {
    const source = readSource("src/hooks/useRubberBills.ts");
    const queuedFallback = source.match(
      /return \{\s+\.\.\.calculatedBill,\s+syncStatus: "pending"[\s\S]*?\n\s+\};/
    )?.[0] ?? "";

    expect(source).toContain('approvalPending: data.status === "pending_approval"');
    expect(queuedFallback).toContain("approvalPending: false");
    expect(queuedFallback).not.toContain("isRubberBillPriceApprovalRequired");
  });

  test("stores server identity beside queued Rubber Bill updates and deletes", () => {
    const source = readSource("src/hooks/useRubberBills.ts");

    expect(source).toContain('serverId: operation === "update" ? bill.id : undefined');
    expect(source).toContain('serverBillNo: operation === "update" ? bill.serverBillNo : undefined');
    expect(source).toContain("serverId: bill.id,");
    expect(source).toContain("serverBillNo: bill.serverBillNo,");
    expect(source).toContain('...(event.serverId ? { expectedServerId: event.serverId } : {})');
    expect(source).toContain('...(operation === "update" ? { expectedServerId: bill.id } : {})');
    expect(source).toContain("sendRubberBillCommand(queuedEvent, { ...payload, expectedServerId: bill.id })");
  });

  test("removes a confirmed Rubber Bill only from its scoped operational feeds", async () => {
    const queryClient = new QueryClient();
    const latestKey = ["rubberBillOperationalFeed", "owner-1", "location-1", "latest", "any", ""];
    const anotherLocationKey = ["rubberBillOperationalFeed", "owner-1", "location-2", "latest", "any", ""];
    const anotherOwnerKey = ["rubberBillOperationalFeed", "owner-2", "location-1", "latest", "any", ""];
    const deletedBill = { id: "server-bill-1", clientTempId: "client-bill-1" };
    const retainedBill = { id: "server-bill-2", clientTempId: "client-bill-2" };
    const deletedEvidence = { billId: deletedBill.id };
    const retainedEvidence = { billId: retainedBill.id };

    queryClient.setQueryData(latestKey, {
      pages: [{
        bills: [deletedBill, retainedBill],
        evidenceStates: [deletedEvidence, retainedEvidence],
        nextCursor: null,
        hasMore: false,
      }],
      pageParams: [null],
    });
    queryClient.setQueryData(anotherLocationKey, {
      pages: [{ bills: [deletedBill], evidenceStates: [], nextCursor: null, hasMore: false }],
      pageParams: [null],
    });
    queryClient.setQueryData(anotherOwnerKey, {
      pages: [{ bills: [deletedBill], evidenceStates: [deletedEvidence], nextCursor: null, hasMore: false }],
      pageParams: [null],
    });

    await removeRubberBillFromOperationalFeedCache(
      queryClient,
      { ownerUserId: "owner-1", locationId: "location-1" },
      "client-bill-1",
    );

    expect(queryClient.getQueryData(latestKey)).toMatchObject({
      pages: [{ bills: [retainedBill], evidenceStates: [retainedEvidence] }],
    });
    expect(queryClient.getQueryData(anotherLocationKey)).toMatchObject({
      pages: [{ bills: [deletedBill] }],
    });
    expect(queryClient.getQueryData(anotherOwnerKey)).toMatchObject({
      pages: [{ bills: [deletedBill], evidenceStates: [deletedEvidence] }],
    });
  });

  test("removes an approval-confirmed Rubber Bill by server identity", async () => {
    const queryClient = new QueryClient();
    const latestKey = ["rubberBillOperationalFeed", "owner-1", "location-1", "latest", "any", ""];
    const deletedBill = { id: "server-bill-1", clientTempId: "client-bill-1" };
    const retainedBill = { id: "server-bill-2", clientTempId: "client-bill-2" };
    queryClient.setQueryData(latestKey, {
      pages: [{
        bills: [deletedBill, retainedBill],
        evidenceStates: [{ billId: deletedBill.id }, { billId: retainedBill.id }],
        nextCursor: null,
        hasMore: false,
      }],
      pageParams: [null],
    });

    await removeRubberBillFromOperationalFeedCacheByBillId(
      queryClient,
      { ownerUserId: "owner-1", locationId: "location-1" },
      deletedBill.id,
    );

    expect(queryClient.getQueryData(latestKey)).toMatchObject({
      pages: [{
        bills: [retainedBill],
        evidenceStates: [{ billId: retainedBill.id }],
      }],
    });
  });

  test("removes a completed Rubber approval request only from pending feeds", async () => {
    const queryClient = new QueryClient();
    const pendingKey = ["rubberBillOperationalFeed", "owner-1", "location-1", "pending_approval", "any", ""];
    const latestKey = ["rubberBillOperationalFeed", "owner-1", "location-1", "latest", "any", ""];
    const pendingBill = {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      approvalRequestId: "request-1",
    };
    const page = {
      pages: [{ bills: [pendingBill], evidenceStates: [], nextCursor: null, hasMore: false }],
      pageParams: [null],
    };
    queryClient.setQueryData(pendingKey, page);
    queryClient.setQueryData(latestKey, page);

    await removeRubberBillApprovalRequestFromPendingFeedCache(
      queryClient,
      { ownerUserId: "owner-1", locationId: "location-1" },
      "request-1",
    );

    expect(queryClient.getQueryData(pendingKey)).toMatchObject({ pages: [{ bills: [] }] });
    expect(queryClient.getQueryData(latestKey)).toMatchObject({ pages: [{ bills: [pendingBill] }] });
  });

  test("marks a possible commit before transport and blocks local mutation until replay", () => {
    const source = readSource("src/hooks/useRubberBills.ts");

    expect(source).toContain(
      'serverSubmissionAttempted: directSubmissionScope !== null',
    );
    expect(source).toContain(
      'if (event.serverSubmissionAttempted !== true)',
    );
    expect(source.match(/clientEvents\.some\(\(event\) => event\.serverSubmissionAttempted === true\)/g))
      .toHaveLength(2);
  });

  test("enqueues new Rubber Bill commands only while the record queue snapshot is still current", () => {
    const source = readSource("src/hooks/useRubberBills.ts");

    expect(source.match(/enqueueSyncEvent\(event, clientEvents\)/g)).toHaveLength(2);
  });
});
