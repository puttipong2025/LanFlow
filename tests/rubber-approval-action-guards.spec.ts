import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

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
      "@/hooks/useRubberBillList": { useRubberBillList: () => ({ bills: [] }), useRubberBillWorkCounts: () => ({}) },
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
