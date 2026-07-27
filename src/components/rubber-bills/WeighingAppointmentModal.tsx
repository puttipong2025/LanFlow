"use client";

import { Clock3, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import { receiptPdfFilename } from "@/lib/rubber-bills/print-receipt";
import {
  buildWeighingAppointmentTicket,
  renderWeighingAppointmentHtml,
  WEIGHING_WAIT_OPTIONS,
} from "@/lib/rubber-bills/weighing-appointment";

export function WeighingAppointmentModal({ onClose }: { onClose: () => void }) {
  const pdfShare = useSharePdf();
  const [sharingMinutes, setSharingMinutes] = useState<number | null>(null);

  async function shareAppointment(waitMinutes: number) {
    setSharingMinutes(waitMinutes);
    try {
      const ticket = buildWeighingAppointmentTicket(waitMinutes, new Date());
      const delivery = await pdfShare.sharePdf(() => ({
        html: renderWeighingAppointmentHtml(ticket),
        filename: receiptPdfFilename(
          "LanFlow-weighing-appointment",
          `${ticket.appointmentDate}-${ticket.appointmentTime}-${waitMinutes}min`,
        ),
      }));
      if (delivery === "shared") {
        toast.success("แชร์ PDF บัตรนัดชั่งแล้ว");
        onClose();
      } else if (delivery === "downloaded") {
        toast.success("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน");
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF บัตรนัดชั่งไม่สำเร็จ");
    } finally {
      setSharingMinutes(null);
    }
  }

  return (
    <ModalShell
      title="จับเวลา"
      subtitle="เลือกเวลารอแล้วแชร์ PDF บัตรนัดชั่งขนาด 80 มม. · ใช้งานออฟไลน์ได้"
      onClose={onClose}
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-river/15 bg-river/5 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-river text-white">
            <Clock3 size={22} />
          </span>
          <div>
            <h3 className="font-bold text-ink">เลือกระยะเวลารอ</h3>
            <p className="mt-1 text-sm text-ink/60">
              เวลานัดชั่งจะคำนวณจากเวลาไทย ณ ตอนที่กดปุ่ม และสร้างเป็น PDF 80 มม.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WEIGHING_WAIT_OPTIONS.map((minutes) => {
            const isSharing = sharingMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                aria-label={`แชร์ PDF บัตรนัด ${minutes} นาที`}
                disabled={pdfShare.busy}
                onClick={() => void shareAppointment(minutes)}
                className="focus-ring group flex min-h-28 flex-col items-center justify-center rounded-2xl bg-amber px-4 py-5 text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-amber/90 hover:shadow-lg disabled:cursor-wait disabled:opacity-50"
              >
                <Share2 size={19} className="mb-2 text-white transition group-hover:scale-110" />
                <span className="text-3xl font-black tabular-nums">{minutes}</span>
                <span className="mt-1 text-sm font-semibold text-white/80">
                  {isSharing ? "กำลังสร้าง PDF..." : "นาที · แชร์ PDF"}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={pdfShare.busy}
          onClick={onClose}
          className="focus-ring mt-5 h-11 w-full rounded-xl bg-actionSecondary font-semibold text-white transition hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ยกเลิก
        </button>
      </div>
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </ModalShell>
  );
}
