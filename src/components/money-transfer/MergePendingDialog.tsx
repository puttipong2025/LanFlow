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
        description="ระบบจะรวมรายการโอนธนาคารที่เข้าเงื่อนไขภายในสาขาปัจจุบัน โปรดตรวจสอบผลกระทบก่อนดำเนินการ"
        confirmLabel={busy ? "กำลังรวม..." : "รวมรายการรอโอน"}
        busy={busy}
        confirmClassName="bg-river hover:bg-river/90"
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-pretty text-sm text-ink/70">
          <li>รวมเฉพาะรายการที่ยังใช้งานอยู่ ซิงก์แล้ว รอโอนผ่านธนาคาร และเป็นลูกค้ากับเลขบัญชีเดียวกันตั้งแต่ 2 รายการขึ้นไป</li>
          <li>รายการต้องไม่มีสลิป และทั้งรายการโอนกับต้นทางต้องไม่ติด Report Lock</li>
          <li>ระบบเก็บรายการที่สร้างก่อนสุดเป็นรายการหลัก ย้ายต้นทางมารวม คำนวณยอดใหม่ และนำเฉพาะรายการโอนรองออกจากรายการใช้งาน โดยไม่ลบบิลยางหรือใบชั่งต้นทาง</li>
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
