"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { useSharePdf } from "@/hooks/useSharePdf";

export type ReceiptPreview = {
  shortId: string;
  locationId: string;
  document?: { html: string; filename: string };
  error?: string;
};

export function MoneyTransferReceiptPreview({ preview, online, offlineMessage, onClose }: {
  preview: ReceiptPreview;
  online: boolean;
  offlineMessage: string;
  onClose: () => void;
}) {
  const pdfShare = useSharePdf();
  const [receiptShareMessage, setReceiptShareMessage] = useState("");

  const shareReceiptPreview = async () => {
    const document = preview.document;
    if (!document || !online || pdfShare.isBusy()) return;
    setReceiptShareMessage("");
    try {
      const delivery = await pdfShare.sharePdf(() => document);
      if (delivery === "shared") setReceiptShareMessage("แชร์ PDF ใบรายการโอนเงินแล้ว");
      if (delivery === "downloaded") setReceiptShareMessage("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
    } catch (error) {
      setReceiptShareMessage(error instanceof Error ? error.message : "สร้าง PDF ใบรายการโอนเงินไม่สำเร็จ");
    }
  };

  return (
    <ModalShell
      title="พรีวิวใบรายการโอนเงิน"
      subtitle={preview.shortId}
      onClose={onClose}
      size="compact"
      mobileFullScreen
      closeOnEscape
      nativeModal
      renderInPortal
    >
      <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
        {pdfShare.waiting && (
          <button type="button" onClick={pdfShare.cancel} className="focus-ring h-10 rounded-md px-3 text-sm font-semibold text-ink">
            ยกเลิกการสร้าง PDF
          </button>
        )}
        <button
          type="button"
          onClick={() => void shareReceiptPreview()}
          disabled={!preview.document || !online || pdfShare.busy}
          title={online ? undefined : offlineMessage}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:opacity-45"
        >
          <Share2 size={16} aria-hidden="true" />
          {pdfShare.busy ? "กำลังสร้าง PDF" : "แชร์ PDF"}
        </button>
      </div>
      {receiptShareMessage && <p role="status" className="pb-2 text-pretty text-sm text-ink">{receiptShareMessage}</p>}
      {preview.error ? (
        <p role="alert" className="text-pretty text-sm font-semibold text-danger">{preview.error}</p>
      ) : preview.document ? (
        <iframe
          title="ใบรายการโอนเงิน 80 มม."
          sandbox=""
          srcDoc={preview.document.html}
          className="mx-auto block h-[60dvh] w-full max-w-[80mm] rounded-md border border-mint bg-white"
        />
      ) : (
        <p role="status" className="py-10 text-center text-sm text-ink/60">กำลังโหลดพรีวิวใบรายการโอนเงิน</p>
      )}
    </ModalShell>
  );
}
