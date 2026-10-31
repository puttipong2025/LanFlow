"use client";

import { ChevronDown, ChevronUp, Settings2, ShieldCheck } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { formatBangkokDateTime } from "@/lib/bangkok-date";
import type { RubberCentralPriceSetting, RubberMaxPriceAllowanceSetting } from "@/types";

export function RubberApprovalSystemSettings({
  central, maximum, centralPrice, maxPriceAllowance, centralChanged, maximumChanged,
  isSaving, canEditMaximum, maximumError, onCentralChange, onMaximumChange,
  onCentralSubmit, onMaximumSubmit, dateRule, autoResetControl, disabled,
}: {
  central: RubberCentralPriceSetting;
  maximum: RubberMaxPriceAllowanceSetting;
  centralPrice: string;
  maxPriceAllowance: string;
  centralChanged: boolean;
  maximumChanged: boolean;
  isSaving: boolean;
  canEditMaximum: boolean;
  maximumError: string | null;
  onCentralChange: (value: string) => void;
  onMaximumChange: (value: string) => void;
  onCentralSubmit: (event: FormEvent) => void;
  onMaximumSubmit: (event: FormEvent) => void;
  dateRule: ReactNode;
  autoResetControl: ReactNode;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const helpId = useId();
  const errorId = useId();

  return (
    <section className="rounded-xl border border-black/10 bg-field/30">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h3 className="text-balance font-bold text-ink">การตั้งค่าทั้งระบบ</h3>
          <p className="mt-1 text-pretty text-sm text-ink/60">ราคากลาง เพดานราคา และกฎวันที่ ใช้ร่วมกันทุกสาขา</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-river/25 bg-white px-4 text-sm font-semibold text-river hover:bg-field"
        >
          <Settings2 size={17} aria-hidden="true" />
          {open ? "ซ่อนการตั้งค่าระบบ" : "ตั้งค่าระบบ"}
          {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      </div>
      <div id={contentId} hidden={!open}>
        <fieldset disabled={disabled} className="grid min-w-0 gap-4 border-t border-black/10 p-4 sm:p-5">
          <section className="min-w-0 rounded-lg border border-black/10 bg-white p-4">
            <h4 className="text-balance font-bold text-ink">ราคากลางยางทั้งระบบ</h4>
            <p className="mt-3 text-pretty text-sm text-ink/60">ราคากลางปัจจุบัน</p>
            <p className="mt-1 text-xl font-bold text-ink"><span className="tabular-nums">{central.value.toFixed(2)}</span> <span className="text-sm font-normal text-ink/60">บาท/กก.</span></p>
            <p className="mt-2 text-pretty text-xs text-ink/60">แก้ไขล่าสุดโดย {central.updatedByName || "ไม่ทราบชื่อ"} · {formatBangkokDateTime(central.updatedAt)}</p>
            <form className="mt-4 grid gap-3" onSubmit={onCentralSubmit}>
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                ราคากลางใหม่ (บาท/กก.)
                <input aria-label="ราคากลางใหม่" inputMode="decimal" value={centralPrice} onChange={(event) => onCentralChange(event.target.value)} placeholder={central.value.toFixed(2)} className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3 tabular-nums" required />
              </label>
              <button type="submit" disabled={!centralChanged || isSaving} className="focus-ring min-h-11 rounded-lg bg-commit px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">เปลี่ยนราคากลาง</button>
            </form>
          </section>

          <section className="min-w-0 rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-start gap-2">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-river" aria-hidden="true" />
              <div>
                <h4 className="text-balance font-bold text-ink">เพดานราคาและกฎวันที่บิล</h4>
                <p className="mt-1 text-pretty text-xs text-ink/60">แก้ไขได้เฉพาะ Super Admin</p>
              </div>
            </div>
            <div className="mt-4">
              <h5 className="text-balance text-sm font-semibold text-ink">ราคายางที่กำหนดสูงสุด</h5>
              <p className="mt-2 text-pretty text-sm text-ink/60">ส่วนต่างสูงสุด <strong className="tabular-nums text-ink">{maximum.value.toFixed(2)} บาท/กก.</strong></p>
              <p className="mt-1 text-pretty text-sm text-ink/60">ราคาเต็มสูงสุดปัจจุบัน <strong className="tabular-nums text-ink">{(central.value + maximum.value).toFixed(2)} บาท/กก.</strong></p>
              <p className="mt-2 text-pretty text-xs text-ink/60">แก้ไขล่าสุดโดย {maximum.updatedByName || "ไม่ทราบชื่อ"} · {formatBangkokDateTime(maximum.updatedAt)}</p>
              {canEditMaximum ? (
                <form className="mt-4 grid gap-3" onSubmit={onMaximumSubmit}>
                  <label className="grid gap-1.5 text-sm font-semibold text-ink">
                    ราคายางที่กำหนดสูงสุด (บาท/กก.)
                    <input
                      aria-label="ราคายางที่กำหนดสูงสุด (บาท/กก.)"
                      aria-describedby={maximumError ? `${helpId} ${errorId}` : helpId}
                      aria-invalid={maximumError ? true : undefined}
                      inputMode="decimal"
                      value={maxPriceAllowance}
                      onChange={(event) => onMaximumChange(event.target.value)}
                      className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3 tabular-nums"
                      required
                    />
                    <span id={helpId} className="text-pretty text-xs font-normal text-ink/60">จำกัดส่วนต่างราคาของทุกกลุ่มและสาขาที่ยังไม่จัดกลุ่ม</span>
                  </label>
                  {maximumError && <p id={errorId} role="alert" className="whitespace-pre-line text-pretty text-sm text-rose-700">{maximumError}</p>}
                  <button type="submit" disabled={!maximumChanged || isSaving} className="focus-ring min-h-11 rounded-lg bg-commit px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">เปลี่ยนค่าสูงสุด</button>
                </form>
              ) : <p className="mt-3 rounded-lg bg-field/55 p-3 text-pretty text-sm text-ink/60">เฉพาะ Superadmin เท่านั้นที่เปลี่ยนค่านี้ได้</p>}
            </div>
            <div className="mt-4 border-t border-black/10 pt-4">{dateRule}</div>
            {autoResetControl}
          </section>
        </fieldset>
      </div>
    </section>
  );
}
