"use client";

import { AlertDialog } from "@/components/shared/AlertDialog";

export type MergePendingDialogState =
  | { kind: "confirm" }
  | { kind: "report_locked"; description: string }
  | null;

export function MergePendingDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: MergePendingDialogState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirming = state?.kind === "confirm";

  return (
    <>
      <AlertDialog
        open={confirming}
        title="รวมรายการรอโอน"
        description="รวมรายการรอโอนของลูกค้าและบัญชีเดียวกันในสาขานี้"
        confirmLabel={busy ? "กำลังรวม..." : "รวมรายการ"}
        busy={busy}
        confirmClassName="bg-actionSecondary hover:bg-actionSecondary/90"
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-pretty text-sm text-ink/70">
          <li>เฉพาะรายการธนาคารที่ซิงก์แล้ว ไม่มีสลิป และไม่ติด Report Lock</li>
          <li>เก็บรายการแรกเป็นรายการหลัก แล้วรวมต้นทางและยอดไว้รายการเดียว</li>
        </ul>
      </AlertDialog>
      <AlertDialog
        open={state?.kind === "report_locked"}
        title="รวมรายการบางส่วนไม่ได้"
        description={state?.kind === "report_locked" ? state.description : ""}
        confirmLabel="รับทราบ"
        cancelLabel={null}
        onCancel={onCancel}
        onConfirm={onCancel}
      />
    </>
  );
}
