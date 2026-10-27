import { Save } from "lucide-react";
import type { RubberBillPolicyStatus } from "@/hooks/useRubberBillPolicyGate";

export function RubberBillSaveActions({ policyStatus, onRetryPolicy, isSubmitting, requiresApproval }: {
  policyStatus: RubberBillPolicyStatus;
  onRetryPolicy?: () => void;
  isSubmitting: boolean;
  requiresApproval: boolean;
}) {
  return (
    <div className="modal-actions border-t border-black/10 p-4">
      {policyStatus !== "ready" && (
        <div role="status" className="mb-3 text-center text-sm text-ink">
          {policyStatus === "loading" ? "กำลังตรวจสอบราคาล่าสุด กรอกข้อมูลต่อได้" : "โหลดกติกาบิลยางล่าสุดไม่สำเร็จ กรุณาลองใหม่ก่อนบันทึก"}
          {policyStatus === "error" && <button type="button" onClick={onRetryPolicy} className="focus-ring ml-2 rounded-md border border-black/20 px-3 py-2 font-semibold">ลองใหม่</button>}
        </div>
      )}
      <div className="flex justify-center">
        <button type="submit" disabled={isSubmitting || policyStatus !== "ready"} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-commit px-5 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-45">
          <Save size={18} aria-hidden="true" />
          {isSubmitting ? "กำลังบันทึก..." : requiresApproval ? "ส่งขออนุมัติ" : "บันทึกบิล"}
        </button>
      </div>
    </div>
  );
}
