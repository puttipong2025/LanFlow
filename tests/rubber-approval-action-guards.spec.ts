import { expect, test } from "@playwright/test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSourceModule } from "./helpers/load-source-module";

test("the rubber approval count distinguishes a missing count from zero", async () => {
  let count: number | null = 0;
  const module = loadSourceModule<typeof import("../src/hooks/useRubberApprovalQueue")>(
    "src/hooks/useRubberApprovalQueue.ts", {
      "@tanstack/react-query": { useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({ refetch: queryFn }) },
      "@/lib/auth-fetch": {},
      "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({
        from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ count, error: null }) }) }) }),
      }) },
    },
  );
  const query = module.useRubberPendingApprovalCount("owner", [], true);
  await expect(Promise.resolve(query.refetch())).resolves.toBe(0);
  count = null;
  await expect(Promise.resolve(query.refetch())).rejects.toThrow();
});

test("the branch loader rejects invalid feed pages and mismatched approval identities", async () => {
  const id = "81000000-0000-4000-8000-000000000001";
  const row = {
    id, location_id: id, row_kind: "bill", work_identity: `bill:${id}`,
    operational_sort_at: "2026-11-09T00:00:00Z", approval_pending: true, approval_request_id: id,
    approval_operation: "update",
  };
  const create = { ...row, row_kind: "approval_create", work_identity: `approval:${id}`, approval_operation: "create", revision_no: 0 };
  const first = { rows: [row], hasMore: true, nextCursor: "next" };
  const end = { rows: [], hasMore: false, nextCursor: null };
  const invalid = [
    [{ ...first, nextCursor: null }],
    [first, first, end],
    [{ ...end, rows: [{ ...row, operational_sort_at: "invalid" }] }],
    [{ ...end, rows: [{ ...create, approval_request_id: "81000000-0000-4000-8000-000000000002" }] }],
    [{ ...end, rows: [{ ...row, approval_operation: "create" }] }],
  ];

  function load(pages: unknown[]) {
    let index = 0;
    const module = loadSourceModule<typeof import("../src/hooks/useRubberApprovalQueue")>(
      "src/hooks/useRubberApprovalQueue.ts", {
        "@tanstack/react-query": {
          useQueries: ({ queries }: { queries: Array<{ queryFn: (context: { signal: AbortSignal }) => unknown }> }) =>
            queries[0].queryFn({ signal: new AbortController().signal }),
        },
        "@/lib/auth-fetch": {
          assertApiResponse: async () => {},
          authFetch: async () => {
            if (index === pages.length) throw new Error("unexpected extra page");
            return Response.json(pages[index++]);
          },
        },
        "@/lib/supabase/client": {},
      },
    );
    return Promise.resolve(module.useRubberApprovalQueue("owner", [{ id, name: "Branch", code: "B", active: true }], "all", true));
  }

  await expect(load([first, end])).resolves.toHaveLength(1);
  await expect(load([{ ...end, rows: [create] }])).resolves.toHaveLength(1);
  for (const pages of invalid) await expect(load(pages)).rejects.toThrow("โหลดคิวบิลยาง");
});

test("the combined queue keeps healthy branches actionable when another branch fails", () => {
  const noop = () => null;
  const module = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillApprovalModal")>(
    "src/components/rubber-bills/RubberBillApprovalModal.tsx", {
      "@/components/shared/AlertDialog": { AlertDialog: noop },
      "@/components/shared/ModalShell": { ModalShell: ({ children }: { children: ReactNode }) => children },
      "@/components/rubber-bills/RubberApprovalPolicyPanel": { RubberApprovalPolicyPanel: noop },
      "@/hooks/useLocations": { useLocations: () => ({ locations: [] }) },
      "@/hooks/useOnlineStatus": { useOnlineStatus: () => true },
      "@/hooks/useRubberBillApprovals": { useRubberBillApprovals: () => ({}) },
      "@/hooks/useRubberApprovalQueue": { useRubberApprovalQueue: () => ({
        bills: [{ id: "request", approvalRequestId: "request", locationId: "branch",
          customerName: "Healthy branch request", clientCreatedAt: "2026-10-05T00:00:00Z",
          billDate: "2026-10-05", netWeight: 1, price: 1, rubberValue: 1, deductionTotal: 0, netTotal: 1 }],
        error: new Error("Failed branch"),
        isLoading: false,
      }) },
      "@/lib/rubber-bills/central-sync": { rubberOwnerWork: async () => [] },
    },
  );
  const markup = renderToStaticMarkup(createElement(module.RubberBillApprovalModal, {
    locationId: "branch", profile: { id: "owner" } as never, onClose: noop,
  }));
  expect(markup).toContain("Healthy branch request");
  expect(markup).toContain("Failed branch");
  expect(markup).toContain('aria-label="อนุมัติ"');
  expect(markup).toContain("ลองใหม่");
});

test("the combined queue follows the feed order across time zones and ties", () => {
  const result = (id: string, operationalSortAt: string) => ({ data: [{ id, operationalSortAt }] });
  const module = loadSourceModule<typeof import("../src/hooks/useRubberApprovalQueue")>(
    "src/hooks/useRubberApprovalQueue.ts", {
      "@tanstack/react-query": {
        useQueries: ({ combine }: { combine: (results: ReturnType<typeof result>[]) => unknown }) =>
          combine([
            result("10000000-0000-4000-8000-000000000001", "2026-11-09T00:00:00.000002Z"),
            result("approval:20000000-0000-4000-8000-000000000001", "2026-11-09T07:00:00.000002+07:00"),
            result("30000000-0000-4000-8000-000000000001", "2026-11-09T07:00:00.000001+07:00"),
          ]),
      },
      "@/lib/auth-fetch": {},
      "@/lib/supabase/client": {},
    },
  );
  const queue = module.useRubberApprovalQueue("owner", [], "all", true);
  expect(queue.bills.map(({ id }) => id)).toEqual([
    "30000000-0000-4000-8000-000000000001",
    "approval:20000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000001",
  ]);
});

test("retrying the combined queue refetches only failed branches", async () => {
  const attempts: string[] = [];
  const failedError = new Error("Failed branch");
  const result = (id: string, error?: Error) => ({
    data: [{ id, operationalSortAt: "2026-11-09T00:00:00Z" }],
    error,
    isError: Boolean(error),
    refetch: async () => { attempts.push(id); },
  });
  const module = loadSourceModule<typeof import("../src/hooks/useRubberApprovalQueue")>(
    "src/hooks/useRubberApprovalQueue.ts", {
      "@tanstack/react-query": {
        useQueries: ({ combine }: { combine: (results: ReturnType<typeof result>[]) => unknown }) =>
          combine([result("healthy"), result("failed", failedError)]),
      },
      "@/lib/auth-fetch": {},
      "@/lib/supabase/client": {},
    },
  );
  const queue = module.useRubberApprovalQueue("owner", [], "all", true);
  expect(queue.bills.map(({ id }) => id)).toEqual(["healthy"]);
  expect(queue.error).toBe(failedError);
  await queue.retryFailed();
  expect(attempts).toEqual(["failed"]);
});

test("same-render approve/cancel cannot duplicate a request while ten independent requests proceed", async () => {
  const references: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0;
  let selected = { kind: "approve", bill: { approvalRequestId: "0", locationId: "branch" } };
  let confirm: () => void = () => {};
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const action = async (id: string) => { calls.push(id); await held; };
  const noop = () => null;
  const alert = () => null;
  const jsx = (type: unknown, props: { onConfirm?: () => void }) => {
    if (type === alert) confirm = props.onConfirm!;
    return {};
  };
  const module = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillApprovalModal")>(
    "src/components/rubber-bills/RubberBillApprovalModal.tsx", {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useState: (value: unknown) => [stateIndex++ === 6 ? selected : value, noop],
        useRef: (value: unknown) => references[refIndex++] ?? (references[refIndex - 1] = { current: value }),
        useMemo: (factory: () => unknown) => factory(), useEffect: noop,
      },
      sonner: { toast: { message: noop, error: noop } },
      "@/components/shared/AlertDialog": { AlertDialog: alert },
      "@/components/shared/ModalShell": { ModalShell: noop },
      "@/components/rubber-bills/RubberApprovalPolicyPanel": { RubberApprovalPolicyPanel: noop },
      "@/hooks/useLocations": { useLocations: () => ({ locations: [] }) },
      "@/hooks/useOnlineStatus": { useOnlineStatus: () => true },
      "@/hooks/useRubberBillApprovals": { useRubberBillApprovals: () => ({ approveRequest: action, deleteRequest: action }) },
      "@/hooks/useRubberApprovalQueue": { useRubberApprovalQueue: () => ({ bills: [] }) },
      "@/lib/rubber-bills/central-sync": { rubberOwnerWork: async () => [] },
    });
  const render = (id: string, kind: string) => {
    selected = { kind, bill: { approvalRequestId: id, locationId: "branch" } };
    stateIndex = 0; refIndex = 0;
    module.RubberBillApprovalModal({ locationId: "branch", profile: { id: "owner" } as never, onClose: noop });
    return confirm;
  };
  for (let i = 0; i < 10; i++) {
    const approve = render(String(i), "approve");
    approve(); approve();
    render(String(i), "delete")();
  }
  expect(calls).toEqual(Array.from({ length: 10 }, (_, i) => String(i)));
  release(); await held;
});
