import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { parsePendingBranchMoneyTransfers } from "../src/hooks/useBranchTransferReceipts";
import { loadBranchTransferDeleteRequests } from "../src/lib/income-expense/branch-transfer-delete-approvals";
import { loadSourceModule } from "./helpers/load-source-module";

test.use({ storageState: { cookies: [], origins: [] } });

test("branch deletion approvals load every pending page beyond the Supabase row cap", async () => {
  const rows: Array<Record<string, string | number | null>> = [...Array.from({ length: 1_001 }, (_, index) => ({
    id: `pending-${index}`,
    location_id: "location-1",
    location_name: "Branch 1",
    transfer_display_no: `TR-${index}`,
    amount: 1,
    request_status: "pending",
    requested_by_name: "Creator",
    requested_by_phone: "0800000000",
    decided_by_name: null,
    decided_by_phone: null,
    created_at: new Date(index).toISOString(),
  })), {
    id: "approved-1",
    location_id: "location-1",
    location_name: "Branch 1",
    transfer_display_no: "TR-approved",
    amount: 1,
    request_status: "approved",
    requested_by_name: "Creator",
    requested_by_phone: "0800000000",
    decided_by_name: "Manager",
    decided_by_phone: "0800000001",
    created_at: new Date(2_000).toISOString(),
  }];
  const supabase = {
    from: () => {
      let pending = true;
      const matchingRows = () => rows.filter((row) => pending
        ? row.request_status === "pending"
        : row.request_status !== "pending");
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (column === "request_status") pending = value === "pending";
          return query;
        },
        neq: () => {
          pending = false;
          return query;
        },
        order: () => query,
        limit: (count: number) => Promise.resolve({ data: matchingRows().slice(0, count), error: null }),
        range: (from: number, to: number) => Promise.resolve({ data: matchingRows().slice(from, to + 1), error: null }),
      };
      return query;
    },
  };

  const result = await loadBranchTransferDeleteRequests(supabase);
  expect(result).toHaveLength(1_002);
  expect(result.filter((row) => row.requestStatus === "pending")).toHaveLength(1_001);
});

test("branch create and target move invalidate both the open and persisted locations", async () => {
  const source = await readFile("src/hooks/useMoneyTransfers.ts", "utf8");

  expect(source).toContain("invalidateMoneyFlowLocations");
  expect(source).toContain("onSuccess: (saved, submitted) => refreshSavedLocations(saved, submitted)");
  expect(source).toContain("saved.locationId");
  expect(source).toContain("submitted.locationId");
  expect(source).toContain("submitted.targetLocationId");
});

test("Money Transfer detail usage does not poll the unused pending-receipt queue", async () => {
  const [hook, module] = await Promise.all([
    readFile("src/hooks/useBranchTransferReceipts.ts", "utf8"),
    readFile("src/components/MoneyTransferModule.tsx", "utf8"),
  ]);

  expect(hook).toContain("includePending = true");
  expect(hook).toContain("enabled: Boolean(includePending && ownerUserId && locationId && online)");
  expect(module).toContain("{ includePending: false }");
});

test("pending branch receipt queue rejects malformed RPC payloads instead of hiding work", () => {
  expect(() => parsePendingBranchMoneyTransfers(null)).toThrow("รูปแบบคิวโอนเข้าบัญชีรอยืนยันไม่ถูกต้อง");
  expect(() => parsePendingBranchMoneyTransfers({ rows: [{}], total: 1 })).toThrow(
    "รูปแบบคิวโอนเข้าบัญชีรอยืนยันไม่ถูกต้อง",
  );
  expect(() => parsePendingBranchMoneyTransfers({ rows: [], total: 1 })).toThrow(
    "รูปแบบคิวโอนเข้าบัญชีรอยืนยันไม่ถูกต้อง",
  );
  expect(parsePendingBranchMoneyTransfers({
    rows: [{
      id: "83000000-0000-4000-8000-000000000001",
      net_amount_to_pay: 123.45,
      created_by_name: "Creator",
    }],
    total: 1,
  })).toEqual({
    transfers: [{
      id: "83000000-0000-4000-8000-000000000001",
      netAmountToPay: 123.45,
      createdByName: "Creator",
    }],
    total: 1,
  });
  expect(parsePendingBranchMoneyTransfers({
    rows: Array.from({ length: 20 }, (_, index) => ({
      id: `83000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      net_amount_to_pay: index + 1,
      created_by_name: "Creator",
    })),
    total: 21,
  })).toMatchObject({ total: 21, transfers: { length: 20 } });
});

test("branch receipt and approved deletion invalidate every affected money-flow view", async () => {
  const [receiptHook, approvalHook] = await Promise.all([
    readFile("src/hooks/useBranchTransferReceipts.ts", "utf8"),
    readFile("src/hooks/useIncomeExpenseApprovals.ts", "utf8"),
  ]);

  expect(receiptHook).toContain("invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId })");
  expect(receiptHook).not.toContain("ACTIONABLE_BADGES_QUERY_KEY");
  expect(receiptHook).not.toContain("INCOME_EXPENSE_FEED_QUERY_KEY");
  expect(approvalHook).toContain("invalidateBranchTransferDeletionViews(queryClient)");

  const invalidation = await readFile("src/lib/money-flow/invalidation.ts", "utf8");
  expect(invalidation).toContain("moneyFlowQueryKeys.branchMoneyTransferReceiptsRoot()");
  expect(invalidation).toContain('["dashboardSnapshot"]');
  expect(invalidation).toContain('["dashboardMoneyHistory"]');
  expect(invalidation).toContain("moneyFlowQueryKeys.dashboardBranchSummaries()");
});

test("approval modal keeps every decision modal-wide single-flight", async () => {
  const source = await readFile(
    "src/components/income-expense/IncomeExpenseApprovalModal.tsx",
    "utf8",
  );

  expect(source).toContain("const decidingRef = useRef<string | null>(null);");
  expect(source).toContain("if (decidingRef.current !== null) return;");
  expect(source.match(/await runDecision\(/g)).toHaveLength(4);
  expect(source).toContain("closeDisabled={decidingId !== null}");
  expect(source).toContain("isDeciding={decidingId !== null}");
  expect(source.match(/disabled={decidingId !== null}/g)).toHaveLength(4);
  expect(source).not.toContain("disabled={decidingId === request.id}");
});

test("branch receipt route rejects a malformed successful RPC result", async () => {
  const transferId = "83000000-0000-4000-8000-000000000001";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/[id]/receive/route")>(
    "src/app/api/lanflow/money-transfers/[id]/receive/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: { rpc: async () => ({ data: null, error: null }) },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/receive", {
    method: "POST",
    body: JSON.stringify({ revisionNo: 0 }),
  }), { params: Promise.resolve({ id: transferId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับผลการยืนยันรับเงินตามรูปแบบที่กำหนด",
  });
});

test("branch receipt route rejects malformed slip rows before reporting a committed receipt", async () => {
  const transferId = "83000000-0000-4000-8000-000000000001";
  const locationId = "81000000-0000-4000-8000-000000000001";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/[id]/receive/route")>(
    "src/app/api/lanflow/money-transfers/[id]/receive/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: {
                id: transferId,
                transfer_type: "branch",
                record_status: "active",
                branch_receipt_contract_version: 1,
                branch_receipt_status: "received",
                virtualStatus: "branch_received",
                idempotentReplay: false,
                revision_no: 1,
                location_id: locationId,
                target_location_id: locationId,
                branch_received_by_user_id: "82000000-0000-4000-8000-000000000002",
                branch_received_by_name: "Receiver",
                branch_received_at: "2026-10-10T01:00:00.000Z",
                accounting_date: "2026-10-10",
                slips: [null],
              },
              error: null,
            }),
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/receive", {
    method: "POST",
    body: JSON.stringify({ revisionNo: 0 }),
  }), { params: Promise.resolve({ id: transferId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับผลการยืนยันรับเงินตามรูปแบบที่กำหนด",
  });
});

test("branch receipt route accepts PostgreSQL-canonical UUID casing after commit", async () => {
  const transferId = "8a000000-0000-4000-8000-00000000000a";
  const locationId = "8b000000-0000-4000-8000-00000000000b";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/[id]/receive/route")>(
    "src/app/api/lanflow/money-transfers/[id]/receive/route.ts",
    {
      "@/lib/server/auth": {
        requireAuth: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: {
                id: transferId,
                transfer_type: "branch",
                record_status: "active",
                branch_receipt_contract_version: 1,
                branch_receipt_status: "received",
                virtualStatus: "branch_received",
                idempotentReplay: false,
                revision_no: 1,
                location_id: locationId,
                target_location_id: locationId,
                branch_received_by_user_id: "8c000000-0000-4000-8000-00000000000c",
                branch_received_by_name: "Receiver",
                branch_received_at: "2026-10-10T01:00:00.000Z",
                accounting_date: "2026-10-10",
                slips: [{
                  id: "8d000000-0000-4000-8000-00000000000d",
                  input_method: "manual",
                  amount: 123.45,
                  reference_number: null,
                  fee: 0,
                  sender_name: null,
                  receiver_name: null,
                  transaction_date: "2026-10-10T00:59:00.000Z",
                  slip_image_url: null,
                  sort_order: 0,
                }],
              },
              error: null,
            }),
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/receive", {
    method: "POST",
    body: JSON.stringify({ revisionNo: 0 }),
  }), { params: Promise.resolve({ id: transferId.toUpperCase() }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: transferId, branch_receipt_status: "received" });
});

test("branch deletion decision route accepts only the matching request and decision", async () => {
  const requestId = "85000000-0000-4000-8000-000000000001";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route")>(
    "src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: {
                status: "approved",
                requestId: "85000000-0000-4000-8000-000000000099",
              },
              error: null,
            }),
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  }), { params: Promise.resolve({ id: requestId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "ระบบไม่ตอบกลับผลการตัดสินคำขอลบตามรูปแบบที่กำหนด",
  });

  const validRoute = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route")>(
    "src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: { status: "rejected", requestId },
              error: null,
            }),
          },
        }),
      },
    },
  );
  const validResponse = await validRoute.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "rejected" }),
  }), { params: Promise.resolve({ id: requestId }) });

  expect(validResponse.status).toBe(200);
  expect(await validResponse.json()).toEqual({ status: "rejected", requestId });
});

test("branch deletion decision route accepts PostgreSQL-canonical UUID casing after commit", async () => {
  const requestId = "8e000000-0000-4000-8000-00000000000e";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route")>(
    "src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: { status: "approved", requestId },
              error: null,
            }),
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  }), { params: Promise.resolve({ id: requestId.toUpperCase() }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "approved", requestId });
});

test("branch deletion decision route reports a changed request as a conflict", async () => {
  const requestId = "85000000-0000-4000-8000-000000000001";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route")>(
    "src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          supabase: {
            rpc: async () => ({
              data: null,
              error: { message: "คำขอลบถูกแก้ไขแล้ว กรุณาลองใหม่", code: "P0001" },
            }),
          },
        }),
      },
    },
  );

  const response = await route.POST(new Request("http://local/decide", {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  }), { params: Promise.resolve({ id: requestId }) });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "คำขอลบถูกแก้ไขแล้ว กรุณาโหลดใหม่" });
});

test("branch deletion uses report-first locking before choosing its deletion path", async () => {
  const [expandMigration, cutoverMigration] = await Promise.all([
    readFile(
      "supabase/migrations/20261009020000_branch_transfer_receipt_expand.sql",
      "utf8",
    ),
    readFile(
      "supabase/migrations/20261009021000_branch_transfer_receipt_cutover.sql",
      "utf8",
    ),
  ]);

  const deleteRequestFunction = expandMigration.match(
    /create or replace function public\.request_branch_money_transfer_delete[\s\S]*?\nend;\n\$\$;/,
  )?.[0];
  const deleteDecisionFunction = expandMigration.match(
    /create or replace function public\.decide_branch_transfer_delete_request[\s\S]*?\nend;\n\$\$;/,
  )?.[0];
  const deleteFunction = cutoverMigration.match(
    /create or replace function public\.delete_money_transfer\([\s\S]*?\nend;\n\$\$;/,
  )?.[0];

  expect(deleteRequestFunction).toBeTruthy();
  expect(deleteDecisionFunction).toBeTruthy();
  expect(deleteFunction).toBeTruthy();

  expect(deleteRequestFunction).toMatch(
    /private\.lock_report_locations[\s\S]*?select \* into v_transfer[\s\S]*?for update;/,
  );
  expect(deleteFunction).toMatch(
    /private\.lock_report_locations[\s\S]*?select \* into v_transfer[\s\S]*?for update;[\s\S]*?return public\.delete_money_transfer_before_branch_receipt/,
  );
  expect(deleteDecisionFunction).toMatch(
    /private\.lock_report_locations[\s\S]*?select \* into v_request[\s\S]*?for update;[\s\S]*?select \* into v_transfer[\s\S]*?for update;/,
  );
});

test("branch receipt mutations reject out-of-scope users before acquiring report locks", async () => {
  const [expandMigration, cutoverMigration] = await Promise.all([
    readFile(
      "supabase/migrations/20261009020000_branch_transfer_receipt_expand.sql",
      "utf8",
    ),
    readFile(
      "supabase/migrations/20261009021000_branch_transfer_receipt_cutover.sql",
      "utf8",
    ),
  ]);

  const receiveFunction = expandMigration.match(
    /create or replace function public\.receive_branch_money_transfer[\s\S]*?\nend;\n\$\$;/,
  )?.[0];
  const deleteRequestFunction = expandMigration.match(
    /create or replace function public\.request_branch_money_transfer_delete[\s\S]*?\nend;\n\$\$;/,
  )?.[0];
  const deleteFunction = cutoverMigration.match(
    /create or replace function public\.delete_money_transfer\([\s\S]*?\nend;\n\$\$;/,
  )?.[0];

  expect(receiveFunction).toMatch(
    /private\.can_access_location\(v_target_location_id\)[\s\S]*?private\.lock_report_locations/,
  );
  expect(deleteRequestFunction).toMatch(
    /private\.can_access_location\(v_locked_location_id\)[\s\S]*?private\.lock_report_locations/,
  );
  expect(deleteFunction).toMatch(
    /private\.can_access_location\(v_locked_location_id\)[\s\S]*?private\.lock_report_locations/,
  );
});

test("branch update rechecks receipt state after acquiring the transfer row lock", async () => {
  const migration = await readFile(
    "supabase/migrations/20261009021000_branch_transfer_receipt_cutover.sql",
    "utf8",
  );
  const saveFunction = migration.match(
    /create or replace function public\.save_money_transfer\([\s\S]*?\nend;\n\$\$;/,
  )?.[0];

  expect(saveFunction).toBeTruthy();
  expect(saveFunction).toMatch(
    /private\.lock_report_locations[\s\S]*?select \* into v_existing[\s\S]*?for update;[\s\S]*?v_existing\.location_id is distinct from v_locked_location_id[\s\S]*?v_existing\.branch_receipt_status <> 'pending_receipt'[\s\S]*?update public\.money_transfers transfer set\s+branch_receipt_contract_version = null/,
  );
});
