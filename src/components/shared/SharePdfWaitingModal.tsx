import { LoaderCircle, X } from "lucide-react";

export function SharePdfWaitingModal({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-pdf-waiting-title"
        className="w-full max-w-sm rounded-md bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <LoaderCircle className="animate-spin text-river" size={24} />
            <div>
              <h2 id="share-pdf-waiting-title" className="text-balance font-bold text-ink">กำลังสร้าง PDF</h2>
              <p className="text-pretty text-sm text-ink/60">บิลบันทึกแล้ว กรุณารอสักครู่</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="ยกเลิกการสร้าง PDF"
            onClick={onCancel}
            className="focus-ring grid size-9 place-items-center rounded-md bg-actionSecondary text-white"
          >
            <X size={17} />
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring mt-5 h-10 w-full rounded-md bg-actionSecondary px-4 text-sm font-semibold text-white hover:bg-actionSecondary/90"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
