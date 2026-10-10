import { ArrowRightLeft } from "lucide-react";

import { BranchTransferReceiptModal } from "@/components/money-transfer/BranchTransferReceiptModal";
import { ModalShell } from "@/components/shared/ModalShell";
import { formatCurrency } from "@/lib/format";
import type { BranchMoneyTransferSummary, MoneyTransfer } from "@/types";

export function BranchTransferReceiptButton({ online, total, firstId, onOpen }: {
  online: boolean;
  total: number;
  firstId?: string;
  onOpen: (id: string) => void;
}) {
  if (!firstId) return null;
  return <button type="button" disabled={!online} onClick={() => onOpen(firstId)} className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-amber px-3 text-sm font-semibold text-white hover:bg-amber/90 disabled:cursor-not-allowed disabled:bg-slate-300">
    <ArrowRightLeft size={18} /> รอยืนยันโอนเข้าบัญชี ({total})
  </button>;
}

export function BranchTransferReceiptQueue({
  online,
  transfers,
  total,
  pendingError,
  retryPending,
  selectedId,
  detail,
  detailError,
  retryDetail,
  onOpen,
  onClose,
  onReceive,
}: {
  online: boolean;
  transfers: BranchMoneyTransferSummary[];
  total: number;
  pendingError: string | null;
  retryPending: () => Promise<unknown>;
  selectedId: string | null;
  detail?: MoneyTransfer;
  detailError: string | null;
  retryDetail: () => Promise<unknown>;
  onOpen: (id: string) => void;
  onClose: () => void;
  onReceive: (revisionNo: number) => Promise<unknown>;
}) {
  return <>
    {pendingError && <section role="alert" aria-label={pendingError} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-clay/30 bg-clay/10 p-3">
      <p className="font-semibold text-clay">{pendingError}</p>
      <button type="button" onClick={() => void retryPending()} disabled={!online} aria-label="ลองใหม่สำหรับคิวโอนเข้าบัญชีรอยืนยัน" className="focus-ring rounded-md bg-river px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">ลองใหม่</button>
    </section>}
    {transfers.length > 0 && <section className="rounded-md border border-amber/40 bg-amber/10 p-3" aria-labelledby="pending-branch-receipts-heading">
      <h3 id="pending-branch-receipts-heading" className="font-bold text-ink">คิวโอนเข้าบัญชีรอยืนยัน</h3>
      <p className="mt-1 text-sm text-ink/60">เปิดตรวจรายละเอียดและสลิปก่อนกดยืนยันรับเงิน</p>
      <div className="mt-2 space-y-2">{transfers.map((transfer) => <button key={transfer.id} type="button" data-transfer-id={transfer.id} disabled={!online} onClick={() => onOpen(transfer.id)} className="focus-ring flex w-full items-center justify-between gap-3 rounded bg-amber px-3 py-2 text-left text-sm text-white hover:bg-amber/90 disabled:opacity-60">
        <span className="min-w-0 truncate">จาก {transfer.createdByName} · {formatCurrency(transfer.netAmountToPay)}</span><span className="shrink-0 font-semibold">เปิดตรวจ</span>
      </button>)}</div>
      {total > transfers.length && <p className="mt-2 text-xs text-ink/60">แสดง 20 รายการที่เก่าที่สุดจาก {total} รายการค้าง</p>}
    </section>}
    {selectedId && (detail ? <BranchTransferReceiptModal transfer={detail} online={online} onReceive={onReceive} onClose={onClose} /> :
      <ModalShell title="ตรวจสอบการโอนเข้าบัญชี" onClose={onClose} size="compact" nativeModal>
        <div className="space-y-3 text-center"><p className="text-sm text-ink/60">{detailError ?? "กำลังโหลดรายละเอียด..."}</p>
          {detailError && <button type="button" onClick={() => void retryDetail()} className="focus-ring rounded-md bg-river px-3 py-2 text-sm font-semibold text-white">ลองใหม่</button>}
        </div>
      </ModalShell>)}
  </>;
}
