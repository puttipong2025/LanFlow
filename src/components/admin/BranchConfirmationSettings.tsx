"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import {
  BRANCH_CONFIRMATION_MAX_MINUTES,
  BRANCH_CONFIRMATION_MIN_MINUTES,
  validBranchConfirmationMinutes,
} from "@/lib/lanflow/branch-create-guard";

export function BranchConfirmationSettings({ initialMinutes, onAccessDenied, onSaved }: {
  initialMinutes: number;
  onAccessDenied: () => void;
  onSaved: (minutes: number) => void;
}) {
  const [savedMinutes, setSavedMinutes] = useState(initialMinutes);
  const [value, setValue] = useState(String(initialMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const minutes = Number(value);
  const valid = validBranchConfirmationMinutes(minutes);
  const dirty = value !== String(savedMinutes);

  async function save() {
    if (!valid) {
      setError("ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที");
      setSuccess(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authFetch("/api/lanflow/admin/branch-confirmation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationMinutes: minutes }),
      });
      const data = await response.json().catch(() => ({})) as {
        confirmationMinutes?: number;
        error?: string;
      };
      if (response.status === 401 || response.status === 403) {
        onAccessDenied();
        return;
      }
      if (!response.ok || !validBranchConfirmationMinutes(data.confirmationMinutes)) {
        throw new Error(data.error || "บันทึกระยะยืนยันสาขาไม่สำเร็จ");
      }
      setSavedMinutes(data.confirmationMinutes);
      setValue(String(data.confirmationMinutes));
      onSaved(data.confirmationMinutes);
      setSuccess("บันทึกแล้ว หน้าอื่นจะใช้ค่านี้เมื่อรีเฟรช");
    } catch (failure) {
      setError(failure instanceof Error && failure.message
        ? failure.message
        : "บันทึกระยะยืนยันสาขาไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="max-w-xl">
        <h3 className="flex items-center gap-2 text-balance text-lg font-bold text-ink">
          <Clock3 aria-hidden="true" size={19} />
          ระยะยืนยันสาขา
        </h3>
        <p className="mt-1 text-pretty text-sm text-ink/60">
          เมื่อครบเวลา การกดสร้างรายการครั้งถัดไปจะให้เลือกยืนยันสาขาอีกครั้ง
        </p>
        <form className="mt-5 space-y-3" noValidate onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="branch-confirmation-minutes">
            ระยะยืนยันสาขา (นาที)
            <input
              id="branch-confirmation-minutes"
              type="number"
              inputMode="numeric"
              min={BRANCH_CONFIRMATION_MIN_MINUTES}
              max={BRANCH_CONFIRMATION_MAX_MINUTES}
              value={value}
              disabled={saving}
              aria-describedby="branch-confirmation-hint"
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="focus-ring h-11 max-w-48 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field"
            />
          </label>
          <p id="branch-confirmation-hint" className="text-pretty text-sm text-ink/60">
            ตั้งได้ 1–120 นาที ค่าเริ่มต้นของระบบคือ 15 นาที
          </p>
          {error && <p role="alert" className="text-pretty rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {success && <p role="status" className="text-pretty rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
          <button
            type="submit"
            disabled={saving || !dirty}
            className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "บันทึกระยะยืนยัน"}
          </button>
        </form>
      </div>
    </section>
  );
}
