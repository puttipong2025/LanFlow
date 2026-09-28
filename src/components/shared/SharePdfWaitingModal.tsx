import { OperationWaitingDialog } from "@/components/shared/OperationWaitingDialog";

export function SharePdfWaitingModal({
  open,
  description = "บิลบันทึกแล้ว กรุณารอสักครู่",
  onCancel,
}: {
  open: boolean;
  description?: string;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <OperationWaitingDialog
      open
      title="กำลังสร้าง PDF"
      description={description}
      cancelLabel="ยกเลิก"
      onCancel={onCancel}
    />
  );
}
