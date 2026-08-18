import { OperationWaitingDialog } from "@/components/shared/OperationWaitingDialog";

export function SharePdfWaitingModal({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <OperationWaitingDialog
      open
      title="กำลังสร้าง PDF"
      description="บิลบันทึกแล้ว กรุณารอสักครู่"
      cancelLabel="ยกเลิก"
      onCancel={onCancel}
    />
  );
}
