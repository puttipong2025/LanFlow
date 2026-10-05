"use client";

import { ArrowLeft, Clock3, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import {
  commitWeighingAppointmentNumber,
  getWeighingAppointmentBrowserStorage,
  getWeighingAppointmentCounterKey,
  previewWeighingAppointmentNumber,
  reserveWeighingAppointmentNumber,
  rollbackWeighingAppointmentNumber,
  WeighingAppointmentCounterError,
} from "@/lib/rubber-bills/weighing-appointment-counter";
import { receiptPdfFilename } from "@/lib/rubber-bills/print-receipt";
import {
  buildWeighingAppointmentTicket,
  isWeighingAppointmentDraftCurrentDay,
  renderWeighingAppointmentHtml,
  WEIGHING_WAIT_OPTIONS,
} from "@/lib/rubber-bills/weighing-appointment";

type AppointmentDraft = {
  waitMinutes: number;
  queueNumber: number;
  issuedAt: Date;
};

type ShareOutcome = "shared" | "downloaded" | "cancelled" | "changed" | "lock-unavailable";

export function WeighingAppointmentModal({
  locationId,
  onClose,
}: {
  locationId: string;
  onClose: () => void;
}) {
  const pdfShare = useSharePdf();
  const helperId = useId();
  const errorId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const firstDurationRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const busy = operationBusy || pdfShare.busy;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (draft) nameInputRef.current?.focus();
      else firstDurationRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft]);

  function requireCounterScope(now = new Date()) {
    const storage = getWeighingAppointmentBrowserStorage();
    if (!storage) {
      throw new WeighingAppointmentCounterError(
        "อุปกรณ์นี้ไม่อนุญาตให้เก็บเลขคิวบัตรนัด จึงยังไม่สามารถแชร์ได้",
      );
    }
    return { locationId, storage, now };
  }

  function requireLockManager() {
    if (!navigator.locks) {
      throw new WeighingAppointmentCounterError(
        "เบราว์เซอร์นี้ไม่รองรับการกันเลขคิวบัตรนัดอย่างปลอดภัย",
      );
    }
    return navigator.locks;
  }

  function selectWaitTime(waitMinutes: number) {
    const issuedAt = new Date();
    try {
      requireLockManager();
      const queueNumber = previewWeighingAppointmentNumber(requireCounterScope(issuedAt));
      setError(null);
      setDraft({ waitMinutes, queueNumber, issuedAt });
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "ไม่สามารถอ่านเลขคิวบัตรนัดได้",
      );
    }
  }

  function resetToPicker({ clearName = false }: { clearName?: boolean } = {}) {
    if (clearName) setCustomerName("");
    setDraft(null);
  }

  function finish() {
    setCustomerName("");
    onClose();
  }

  async function shareAppointment() {
    if (!draft || busy) return;
    const now = new Date();
    if (!isWeighingAppointmentDraftCurrentDay(draft.issuedAt, now)) {
      setError("วันออกบัตรเปลี่ยนแล้ว กรุณาเลือกเวลารอใหม่เพื่อเริ่มเลขคิวของวันใหม่");
      resetToPicker();
      return;
    }

    setError(null);
    setOperationBusy(true);
    try {
      const scope = requireCounterScope(now);
      const lockManager = requireLockManager();
      const lockName = getWeighingAppointmentCounterKey(locationId);
      const outcome = await lockManager.request(
        lockName,
        { ifAvailable: true },
        async (lock): Promise<ShareOutcome> => {
          if (!lock) return "lock-unavailable";

          const token = crypto.randomUUID();
          const reservation = reserveWeighingAppointmentNumber({
            ...scope,
            expectedNumber: draft.queueNumber,
            token,
          });
          if (reservation.kind === "changed") {
            setDraft((current) => current && ({
              ...current,
              queueNumber: reservation.nextNumber,
            }));
            return "changed";
          }

          const ticket = buildWeighingAppointmentTicket({
            waitMinutes: draft.waitMinutes,
            queueNumber: reservation.number,
            customerName,
            issuedAt: draft.issuedAt,
          });

          let delivery: "shared" | "downloaded" | "cancelled";
          try {
            delivery = await pdfShare.sharePdf(() => ({
              html: renderWeighingAppointmentHtml(ticket),
              filename: receiptPdfFilename(
                "LanFlow-weighing-appointment",
                `Q${ticket.queueNumber}-${ticket.appointmentDate}-${ticket.appointmentTime}`,
              ),
            }));
          } catch (shareError) {
            rollbackWeighingAppointmentNumber({ ...scope, token });
            throw shareError;
          }

          if (delivery === "cancelled") {
            rollbackWeighingAppointmentNumber({ ...scope, token });
            return "cancelled";
          }

          commitWeighingAppointmentNumber({ ...scope, token });
          return delivery;
        },
      );

      if (outcome === "lock-unavailable") {
        setError("อีกแท็บกำลังออกบัตรนัด กรุณารอให้เสร็จแล้วลองใหม่");
      } else if (outcome === "changed") {
        setError("เลขคิวมีการเปลี่ยนแปลง ระบบอัปเดตเลขใหม่แล้ว กรุณาตรวจสอบและกดแชร์อีกครั้ง");
      } else if (outcome === "cancelled") {
        window.requestAnimationFrame(() => nameInputRef.current?.focus());
      } else if (outcome === "shared" || outcome === "downloaded") {
        toast.success(
          outcome === "shared"
            ? "แชร์ PDF บัตรนัดชั่งแล้ว"
            : "แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน",
        );
        resetToPicker({ clearName: true });
      }
    } catch (shareError) {
      const message = shareError instanceof Error
        ? shareError.message
        : "สร้าง PDF บัตรนัดชั่งไม่สำเร็จ";
      setError(message);
      toast.error(message);
    } finally {
      setOperationBusy(false);
    }
  }

  const ticket = draft
    ? buildWeighingAppointmentTicket({
        waitMinutes: draft.waitMinutes,
        queueNumber: draft.queueNumber,
        customerName,
        issuedAt: draft.issuedAt,
      })
    : null;

  return (
    <ModalShell
      title="จับเวลา"
      subtitle={draft
        ? "ตรวจสอบบัตรนัดก่อนแชร์ PDF ขนาด 80 มม."
        : "เลือกเวลารอเพื่อสร้างบัตรนัดชั่ง · ใช้งานออฟไลน์ได้"}
      onClose={finish}
      closeOnEscape
      closeDisabled={busy}
      nativeModal
      size="compact"
    >
      <div aria-busy={busy} className="space-y-5">
        {!draft ? (
          <>
            <div className="flex items-start gap-3 rounded-xl border border-river/15 bg-river/5 p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-river text-white">
                <Clock3 size={22} aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-bold text-ink">เลือกระยะเวลารอ</h3>
                <p className="mt-1 text-pretty text-sm text-ink/60">
                  เวลานัดจะล็อกทันทีเมื่อเลือก แล้วระบบจะพาไปตรวจสอบชื่อและเลขคิวก่อนแชร์
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {WEIGHING_WAIT_OPTIONS.map((minutes, index) => (
                <button
                  ref={index === 0 ? firstDurationRef : undefined}
                  key={minutes}
                  type="button"
                  aria-label={`เลือกเวลารอ ${minutes} นาที`}
                  disabled={busy}
                  onClick={() => selectWaitTime(minutes)}
                  className="focus-ring flex min-h-24 flex-col items-center justify-center rounded-xl bg-amber px-4 py-4 text-white shadow-sm hover:bg-amber/90 disabled:cursor-wait disabled:opacity-50"
                >
                  <span className="text-3xl font-black tabular-nums">{minutes}</span>
                  <span className="mt-1 text-sm font-semibold text-white/85">นาที</span>
                </button>
              ))}
            </div>
          </>
        ) : ticket ? (
          <>
            <div className="rounded-xl border border-amber/30 bg-amber/10 p-4 text-center">
              <p className="text-sm font-bold text-ink/65">เลขคิวบัตรนัด</p>
              <p className="mt-1 text-5xl font-black tabular-nums text-ink">{ticket.queueNumber}</p>
            </div>

            <label className="grid gap-2 text-sm font-bold text-ink">
              <span>ชื่อลูกค้า <span className="font-normal text-ink/55">(ไม่บังคับ)</span></span>
              <input
                ref={nameInputRef}
                type="text"
                autoComplete="off"
                maxLength={100}
                value={customerName}
                aria-describedby={`${helperId}${error ? ` ${errorId}` : ""}`}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  if (error) setError(null);
                }}
                className="focus-ring h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-base text-ink"
                placeholder="กรอกชื่อถ้าต้องการ"
              />
            </label>
            <p id={helperId} className="text-pretty text-xs text-ink/55">
              ชื่อจะอยู่ใน PDF เท่านั้น และไม่ถูกบันทึกในประวัติ
            </p>

            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-black/10 bg-sand/60 p-4 text-sm">
              <div>
                <dt className="text-ink/55">เวลารอ</dt>
                <dd className="mt-1 font-bold tabular-nums text-ink">{ticket.waitMinutes} นาที</dd>
              </div>
              <div>
                <dt className="text-ink/55">เวลานัดชั่ง</dt>
                <dd className="mt-1 font-bold tabular-nums text-ink">
                  {ticket.appointmentTime} น.{ticket.isNextDay ? " (วันถัดไป)" : ""}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink/55">วันที่นัด</dt>
                <dd className="mt-1 font-bold tabular-nums text-ink">{ticket.appointmentDate}</dd>
              </div>
            </dl>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => resetToPicker()}
                className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft size={17} aria-hidden="true" />
                เปลี่ยนเวลา
              </button>
              <button
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void shareAppointment()}
                className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-yellow-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-yellow-800 disabled:cursor-wait disabled:opacity-50"
              >
                <Share2 size={17} aria-hidden="true" />
                {busy ? "กำลังสร้าง PDF..." : "แชร์ PDF"}
              </button>
            </div>
          </>
        ) : null}

        {error && (
          <p
            id={errorId}
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-pretty text-sm font-semibold text-danger"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={finish}
          className="focus-ring h-10 w-full rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          เสร็จสิ้น
        </button>
      </div>
      <SharePdfWaitingModal
        open={pdfShare.waiting}
        description="กำลังเตรียมบัตรนัดชั่งสำหรับแชร์ กรุณารอสักครู่"
        onCancel={pdfShare.cancel}
      />
    </ModalShell>
  );
}
