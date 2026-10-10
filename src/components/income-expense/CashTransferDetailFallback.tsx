import { ModalShell } from "@/components/shared/ModalShell";

export function CashTransferDetailFallback({ title, offlineMessage, detailError, online, onRetry, onClose }: {
  title: string;
  offlineMessage: string;
  detailError: string | null;
  online: boolean;
  onRetry: () => Promise<unknown>;
  onClose: () => void;
}) {
  return <ModalShell title={title} onClose={onClose}>
    {detailError ? <div role="alert" aria-label={detailError} className="space-y-3">
      <p className="font-semibold text-clay">{detailError}</p>
      <button type="button" onClick={() => void onRetry()} disabled={!online} aria-label="ลองใหม่สำหรับรายละเอียดเงินสด" className="focus-ring rounded-md bg-river px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">ลองใหม่</button>
    </div> : <p role="status">{online ? "กำลังโหลดรายละเอียดเงินสด…" : offlineMessage}</p>}
  </ModalShell>;
}
