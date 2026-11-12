"use client";
import { useId, useState } from "react";

export function BonusDecimalField({ label, value, change, ariaInvalid, ariaDescribedBy }: { label: string; value: number; change: (value: number) => void; ariaInvalid?: boolean; ariaDescribedBy?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  return <div><label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">{label}</span>
    <input type="text" inputMode="decimal" className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3 tabular-nums"
      aria-invalid={invalid || !!ariaInvalid} aria-describedby={[ariaDescribedBy, invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined} value={draft ?? (Number.isFinite(value) ? value.toFixed(2) : "")} onFocus={() => {
        if (draft !== null && !Number.isFinite(value)) return;
        setDraft(value === 0 || !Number.isFinite(value) ? "" : value.toFixed(2));
      }}
      onChange={e => setDraft(e.target.value)} onBlur={() => {
        const raw = (draft ?? String(value)).trim();
        const number = raw === "" ? 0 : /^[-+]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw) ? Number(raw.replaceAll(",", "")) : Number.NaN;
        setInvalid(!Number.isFinite(number));
        change(Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : Number.NaN);
        if (Number.isFinite(number)) setDraft(null);
      }} /></label>
    {invalid && <p id={errorId} role="alert" className="mt-1 text-pretty text-sm text-clay">กรอกตัวเลขให้ถูกต้อง</p>}
  </div>;
}
