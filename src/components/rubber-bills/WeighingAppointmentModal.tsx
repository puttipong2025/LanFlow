"use client";

import { Clock3, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { printReceiptHtml } from "@/lib/rubber-bills/print-receipt";
import {
  buildWeighingAppointmentTicket,
  renderWeighingAppointmentHtml,
  WEIGHING_WAIT_OPTIONS,
} from "@/lib/rubber-bills/weighing-appointment";

export function WeighingAppointmentModal({ onClose }: { onClose: () => void }) {
  const [printingMinutes, setPrintingMinutes] = useState<number | null>(null);

  async function printAppointment(waitMinutes: number) {
    setPrintingMinutes(waitMinutes);
    try {
      const ticket = buildWeighingAppointmentTicket(waitMinutes, new Date());
      await printReceiptHtml(renderWeighingAppointmentHtml(ticket));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "พิมพ์บัตรนัดชั่งไม่สำเร็จ");
      setPrintingMinutes(null);
    }
  }

  return (
    <ModalShell
      title="จับเวลา"
      subtitle="เลือกเวลารอแล้วระบบจะเปิดหน้าพิมพ์ทันที · ใช้งานออฟไลน์ได้"
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
              เวลานัดชั่งจะคำนวณจากเวลาไทย ณ ตอนที่กดปุ่ม และพิมพ์บนกระดาษ 80 มม.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WEIGHING_WAIT_OPTIONS.map((minutes) => {
            const isPrinting = printingMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                aria-label={`พิมพ์บัตรนัด ${minutes} นาที`}
                disabled={printingMinutes !== null}
                onClick={() => void printAppointment(minutes)}
                className="focus-ring group flex min-h-28 flex-col items-center justify-center rounded-2xl border border-black/10 bg-white px-4 py-5 text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-river/35 hover:shadow-lg disabled:cursor-wait disabled:opacity-50"
              >
                <Printer size={19} className="mb-2 text-river transition group-hover:scale-110" />
                <span className="text-3xl font-black tabular-nums">{minutes}</span>
                <span className="mt-1 text-sm font-semibold text-ink/55">
                  {isPrinting ? "กำลังเปิดหน้าพิมพ์..." : "นาที"}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={printingMinutes !== null}
          onClick={onClose}
          className="focus-ring mt-5 h-11 w-full rounded-xl bg-field font-semibold text-ink transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ยกเลิก
        </button>
      </div>
    </ModalShell>
  );
}
