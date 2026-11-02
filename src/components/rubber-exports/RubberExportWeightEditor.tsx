"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { calculateCurrentWeight, calculateWeightLossPercent, hasTwoDecimalPrecision, isValidCurrentWeight } from "@/lib/rubber-exports/calculations";
import type { RubberExportDetails, RubberExportEditValues } from "@/types/rubber-exports";

function number(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RubberExportWeightEditor({ details, canAdjust, busy, value, onChange, onInvalidChange, onBusyChange, onSave }: {
  details: RubberExportDetails;
  canAdjust: boolean;
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
  onInvalidChange: (invalid: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onSave: (values: RubberExportEditValues) => Promise<void>;
}) {
  const isDraft = details.status === "draft";
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"weight" | "percent">("weight");
  const [percentInput, setPercentInput] = useState(String(details.weightLossPercent ?? 0));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveLock = useRef(false);
  const weightRef = useRef<HTMLInputElement>(null);
  const adjustRef = useRef<HTMLButtonElement>(null);
  const expanded = isDraft || editing;
  const currentWeight = value.trim() === "" ? null : Number(value);
  const weightValid = isValidCurrentWeight(details.originalWeightTotal, currentWeight);
  const computedPercent = currentWeight === null ? null : calculateWeightLossPercent(details.originalWeightTotal, currentWeight);
  const percent = Number(percentInput);
  const percentValid = percentInput.trim() !== "" && hasTwoDecimalPrecision(percent) && percent >= 0 && percent < 100;
  const invalid = mode === "percent" ? percentInput.trim() !== "" && (!percentValid || !weightValid) : value.trim() !== "" && !weightValid;
  const blocked = details.reportLockNo ? `ล็อกโดยรายงาน ${details.reportLockNo}`
    : details.receiptBillId || details.receiptBillNo ? "มีบิลรับเข้าอ้างอิงรายการนี้แล้ว"
      : details.hasWexReservation ? "ถูกจองในบิลรถส่งออก WEX"
        : details.soldOutAt ? "รายการนี้ขายแล้ว" : null;
  const busyOrBlocked = busy || saving || (!isDraft && Boolean(blocked));
  useEffect(() => { onInvalidChange(invalid); }, [invalid, onInvalidChange]);

  function changePercent(next: string) {
    setPercentInput(next);
    const weight = next.trim() === "" ? null : calculateCurrentWeight(details.originalWeightTotal, Number(next));
    onChange(weight === null ? "" : String(weight));
  }
  function selectMode(next: "weight" | "percent") {
    setMode(next);
    // Changing the input method must not recalculate a rounded percentage back into weight.
    if (next === "percent") {
      setPercentInput(computedPercent === null ? "" : String(computedPercent));
    }
  }
  function cancel() {
    onChange(String(details.currentWeight ?? 0));
    setPercentInput(String(details.weightLossPercent ?? 0));
    setEditing(false); setSaveError(null); setNote("");
    requestAnimationFrame(() => adjustRef.current?.focus());
  }
  async function save() {
    if (saveLock.current || busy || !canAdjust || !weightValid || currentWeight === null || details.currentWeight == null || blocked || invalid) return;
    saveLock.current = true; setSaving(true); onBusyChange(true); setSaveError(null);
    try {
      await onSave({ currentWeight, workRate: details.workRate ?? null, otherOperatingCost: details.otherOperatingCost,
        adjustment: { expectedCurrentWeight: details.currentWeight, note } });
      setEditing(false);
      requestAnimationFrame(() => adjustRef.current?.focus());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "บันทึกน้ำหนักไม่สำเร็จ");
    } finally { saveLock.current = false; setSaving(false); onBusyChange(false); }
  }

  return (
    <div className="space-y-3" aria-busy={saving}>
      {!isDraft && !editing && <div>
        <label htmlFor="rubber-export-current-weight" className="mb-1 block text-sm font-semibold text-ink/70">น้ำหนักปัจจุบัน</label>
        <div className="flex items-center gap-2">
          <input id="rubber-export-current-weight" type="number" value={value} readOnly className="h-11 min-w-0 flex-1 rounded-md border border-black/10 bg-slate-100 px-3 tabular-nums" />
          {canAdjust && <button ref={adjustRef} type="button" disabled={Boolean(blocked)} aria-expanded={false} aria-controls="rubber-export-weight-editor"
            onClick={() => { setEditing(true); setMode("weight"); setSaveError(null); requestAnimationFrame(() => weightRef.current?.focus()); }}
            className="focus-ring h-11 rounded-md bg-river px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">ปรับ</button>}
        </div>
        {canAdjust && blocked && <p className="mt-1 text-sm text-ink/60">ปรับน้ำหนักไม่ได้: {blocked}</p>}
      </div>}
      {expanded && <div id="rubber-export-weight-editor" className="space-y-3">
        <fieldset disabled={busyOrBlocked} aria-describedby="rubber-export-weight-help">
          <legend className="mb-2 text-sm font-semibold text-ink">{isDraft ? "เลือกวิธีกรอกน้ำหนัก" : "ปรับน้ำหนักย้อนหลัง"}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-md border p-3 ${mode === "weight" ? "border-leaf" : "border-black/10"}`}>
              <label className="mb-2 flex min-h-10 items-center gap-2 text-sm font-semibold">
                <input type="radio" name="rubber-export-weight-mode" checked={mode === "weight"} onChange={() => selectMode("weight")} className="focus-ring size-4 accent-leaf" />
                <span id="rubber-export-current-weight-label">น้ำหนักปัจจุบัน (กก.)</span>
              </label>
              <input ref={weightRef} id="rubber-export-current-weight" type="number" min="0.01" max={details.originalWeightTotal} step="0.01" inputMode="decimal"
                aria-labelledby="rubber-export-current-weight-label" aria-invalid={mode === "weight" && invalid || undefined} aria-describedby="rubber-export-weight-help rubber-export-weight-entry-error"
                value={value} readOnly={mode !== "weight"} onFocus={(event) => { if (mode === "weight" && Number(event.currentTarget.value) === 0) onChange(""); }}
                onBlur={() => { if (mode === "weight" && value.trim() === "") onChange("0"); }}
                onChange={(event) => onChange(event.currentTarget.value)} className="focus-ring h-11 w-full rounded-md border border-black/10 px-3 tabular-nums read-only:bg-slate-100" />
              <p className="mt-1 text-xs text-ink/60">{mode === "weight" ? "กรอกค่านี้" : "คำนวณอัตโนมัติ · อ่านอย่างเดียว"}</p>
            </div>
            <div className={`rounded-md border p-3 ${mode === "percent" ? "border-leaf" : "border-black/10"}`}>
              <label className="mb-2 flex min-h-10 items-center gap-2 text-sm font-semibold">
                <input type="radio" name="rubber-export-weight-mode" checked={mode === "percent"} onChange={() => selectMode("percent")} className="focus-ring size-4 accent-leaf" />
                <span id="rubber-export-loss-percent-label">น้ำหนักลดลง (%)</span>
              </label>
              <input id="rubber-export-loss-percent" type="number" min="0" max="99.99" step="0.01" inputMode="decimal" value={mode === "percent" ? percentInput : computedPercent === null ? "" : String(computedPercent)} readOnly={mode !== "percent"}
                aria-labelledby="rubber-export-loss-percent-label" aria-invalid={mode === "percent" && invalid || undefined} aria-describedby="rubber-export-weight-help rubber-export-weight-entry-error"
                onChange={(event) => changePercent(event.currentTarget.value)} className="focus-ring h-11 w-full rounded-md border border-black/10 px-3 tabular-nums read-only:bg-slate-100" />
              <p className="mt-1 text-xs text-ink/60">{mode === "percent" ? "กรอกค่านี้" : "คำนวณอัตโนมัติ · อ่านอย่างเดียว"}</p>
            </div>
          </div>
        </fieldset>
        <p id="rubber-export-weight-help" className="text-xs text-ink/60">เลือกกรอกได้ครั้งละ 1 ช่อง · ใช้น้ำหนักสุทธิรวมเดิม {number(details.originalWeightTotal)} กก. เป็นฐานเสมอ · ลดลง 0% คือน้ำหนักเท่าเดิม</p>
        <p id="rubber-export-weight-entry-error" role={invalid ? "alert" : undefined} className="text-sm font-semibold text-danger">
          {invalid && (mode === "percent" ? percentValid ? "เปอร์เซ็นต์นี้ทำให้น้ำหนักหลังปัดเศษเป็นศูนย์ กรุณาลดเปอร์เซ็นต์หรือกรอกน้ำหนักอย่างน้อย 0.01 กก." : "เปอร์เซ็นต์ต้องตั้งแต่ 0 ถึงน้อยกว่า 100 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" : `น้ำหนักต้องมากกว่า 0 ไม่เกิน ${number(details.originalWeightTotal)} กก. และมีทศนิยมไม่เกิน 2 ตำแหน่ง`)}</p>
        {!isDraft && <>
          <p className="rounded-md bg-field p-3 text-sm">น้ำหนัก {number(details.currentWeight ?? 0)} → {weightValid && currentWeight !== null ? number(currentWeight) : "—"} กก. · ยอดโอน สลิป และรายงานโอนคงเดิม</p>
          <label className="block text-sm font-semibold">หมายเหตุการปรับ (ถ้ามี)<input type="text" maxLength={300} value={note} disabled={saving} onChange={(event) => setNote(event.currentTarget.value)} className="focus-ring mt-1 h-11 w-full rounded-md border border-black/10 px-3" /></label>
          {saveError && <p role="alert" className="text-sm font-semibold text-danger">{saveError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={cancel} className="focus-ring rounded-md border border-black/10 px-4 py-2 font-semibold">ยกเลิก</button>
            <button type="button" disabled={saving || Boolean(blocked) || !weightValid || invalid || currentWeight === details.currentWeight} onClick={() => void save()}
              className="focus-ring inline-flex items-center gap-2 rounded-md bg-commit px-4 py-2 font-semibold text-white disabled:opacity-45">{saving && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />}บันทึกน้ำหนัก</button>
          </div>
          {currentWeight === details.currentWeight && <p className="text-right text-xs text-ink/60">แก้ไขน้ำหนักก่อนบันทึก</p>}
        </>}
      </div>}
      {Boolean(details.weightAdjustments?.length) && <details className="rounded-md border border-black/10 p-3">
        <summary className="cursor-pointer text-sm font-semibold">ประวัติการปรับน้ำหนัก</summary>
        <ul className="mt-2 space-y-2 text-sm">{details.weightAdjustments?.map((entry) => <li key={entry.id}>
          <p className="tabular-nums">{number(entry.previousWeight)} → {number(entry.currentWeight)} กก. · {number(entry.lossPercent)}%</p>
          <p className="text-xs text-ink/60">{entry.actorName} · {new Date(entry.adjustedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}{entry.note ? ` · ${entry.note}` : ""}</p>
        </li>)}</ul>
      </details>}
    </div>
  );
}
