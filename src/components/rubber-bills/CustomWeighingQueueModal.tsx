"use client";

import { Share2 } from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import {
  buildCustomWeighingQueueTicket,
  parseCustomQueueNumber,
  renderCustomWeighingQueueTicketHtml,
  sanitizeCustomQueueNumberInput,
} from "@/lib/rubber-bills/custom-weighing-queue";
import { receiptPdfFilename } from "@/lib/rubber-bills/print-receipt";

export function CustomWeighingQueueModal({ onClose }: { onClose: () => void }) {
  const pdfShare = useSharePdf();
  const helperId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queueNumberDraft, setQueueNumberDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function shareTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queueNumber = parseCustomQueueNumber(queueNumberDraft);
    if (queueNumber === null) {
      setError("กรุณาระบุเลขลำดับคิวตั้งแต่ 1 ถึง 9999");
      return;
    }

    setError(null);
    try {
      const ticket = buildCustomWeighingQueueTicket(queueNumber, new Date());
      const delivery = await pdfShare.sharePdf(() => ({
        html: renderCustomWeighingQueueTicketHtml(ticket),
        filename: receiptPdfFilename(
          "LanFlow-custom-weighing-queue",
          `Q${ticket.queueNumber}-${ticket.issuedDate}-${ticket.issuedTime}`,
        ),
      }));
      if (delivery === "cancelled") return;

      toast.success(
        delivery === "shared"
          ? "แชร์ PDF บัตรคิวกำหนดเองแล้ว"
          : "แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน",
      );
      onClose();
    } catch (shareError) {
      toast.error(shareError instanceof Error ? shareError.message : "สร้าง PDF บัตรคิวไม่สำเร็จ");
    }
  }

  return (
    <ModalShell
      title="บัตรคิวกำหนดเอง"
      subtitle="ป้อนเลข 1–9999 แล้วแชร์ PDF ขนาด 80 มม. · ใช้งานออฟไลน์ได้"
      onClose={onClose}
      closeOnEscape
      closeDisabled={pdfShare.busy}
      nativeModal
      size="compact"
    >
      <form onSubmit={(event) => void shareTicket(event)} className="space-y-5">
        <label className="grid gap-2 text-sm font-bold text-ink">
          เลขลำดับคิว
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={queueNumberDraft}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={`${helperId}${error ? ` ${errorId}` : ""}`}
            onChange={(event) => {
              setQueueNumberDraft(sanitizeCustomQueueNumberInput(event.target.value));
              if (error) setError(null);
            }}
            className="focus-ring h-20 w-full rounded-xl border border-black/15 bg-white px-4 text-center text-4xl font-black tabular-nums text-ink"
          />
        </label>
        <p id={helperId} className="text-pretty text-sm text-ink/60">
          ระบบไม่ตรวจเลขต่อเนื่องหรือเลขซ้ำ และไม่บันทึกเลขหรือประวัติการแชร์
        </p>
        {error && (
          <p id={errorId} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pdfShare.busy}
          aria-busy={pdfShare.busy}
          className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-leaf px-5 font-bold text-white shadow-sm hover:bg-leaf/90 disabled:cursor-wait disabled:opacity-50"
        >
          <Share2 size={19} aria-hidden="true" />
          {pdfShare.busy ? "กำลังสร้าง PDF..." : "แชร์ PDF บัตรคิว"}
        </button>
      </form>
      <SharePdfWaitingModal
        open={pdfShare.waiting}
        description="กำลังเตรียมบัตรคิวสำหรับแชร์ กรุณารอสักครู่"
        onCancel={pdfShare.cancel}
      />
    </ModalShell>
  );
}
