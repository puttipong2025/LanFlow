"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import { authFetch } from "@/lib/auth-fetch";
import {
  RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES,
  RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG,
  RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES,
  RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG,
  parseRubberWeightAlertConfig,
  validRubberWeightAlertInterval,
  validRubberWeightAlertThreshold,
  type RubberWeightAlertConfig,
} from "@/lib/lanflow/rubber-weight-alert";

const VALIDATION_MESSAGE = "เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก. และรอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที";

export function RubberWeightAlertSettings({
  initialConfig,
  onAccessDenied,
  onSaved,
}: {
  initialConfig: RubberWeightAlertConfig;
  onAccessDenied: () => void;
  onSaved: (config: RubberWeightAlertConfig) => void;
}) {
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [thresholdValue, setThresholdValue] = useState(String(initialConfig.thresholdKg));
  const [intervalValue, setIntervalValue] = useState(String(initialConfig.intervalMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const thresholdKg = Number(thresholdValue);
  const intervalMinutes = Number(intervalValue);
  const thresholdValid = validRubberWeightAlertThreshold(thresholdKg);
  const intervalValid = validRubberWeightAlertInterval(intervalMinutes);
  const dirty = thresholdValue !== String(savedConfig.thresholdKg)
    || intervalValue !== String(savedConfig.intervalMinutes);

  useEffect(() => {
    if (savedConfig.thresholdKg === initialConfig.thresholdKg
      && savedConfig.intervalMinutes === initialConfig.intervalMinutes) return;
    setSavedConfig(initialConfig);
    if (!dirty) {
      setThresholdValue(String(initialConfig.thresholdKg));
      setIntervalValue(String(initialConfig.intervalMinutes));
    }
  }, [dirty, initialConfig, savedConfig]);

  async function save() {
    if (!thresholdValid || !intervalValid) {
      setError(VALIDATION_MESSAGE);
      setSuccess(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authFetch("/api/lanflow/admin/rubber-weight-alert", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdKg, intervalMinutes }),
      });
      const data = await response.json().catch(() => ({})) as unknown;
      if (response.status === 401 || response.status === 403) {
        onAccessDenied();
        return;
      }
      const config = parseRubberWeightAlertConfig(data);
      if (!response.ok || !config) {
        const message = data && typeof data === "object" && "error" in data
          ? String(data.error)
          : "บันทึกการแจ้งเตือนน้ำหนักไม่สำเร็จ";
        throw new Error(message);
      }
      setSavedConfig(config);
      setThresholdValue(String(config.thresholdKg));
      setIntervalValue(String(config.intervalMinutes));
      onSaved(config);
      setSuccess("บันทึกแล้ว เครื่องนี้ใช้รอบเวลาใหม่ทันที");
    } catch (failure) {
      setError(failure instanceof Error && failure.message
        ? failure.message
        : "บันทึกการแจ้งเตือนน้ำหนักไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const errorDescription = error ? "rubber-weight-alert-error" : undefined;
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="max-w-2xl">
        <h3 className="flex items-center gap-2 text-balance text-lg font-bold text-ink">
          <BellRing aria-hidden="true" size={19} />
          แจ้งเตือนน้ำหนักสุทธิสะสม
        </h3>
        <p className="mt-1 text-pretty text-sm text-ink/60">
          ตรวจค่าใน Dashboard ตามรอบเวลา และรวมทุกสาขาที่เกินเกณฑ์ไว้ในหน้าต่างเดียว
        </p>
        <form className="mt-5 space-y-4" noValidate onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold" htmlFor="rubber-weight-alert-threshold">
              เกณฑ์น้ำหนักสุทธิสะสม (กก.)
              <input
                id="rubber-weight-alert-threshold"
                type="number"
                inputMode="numeric"
                min={RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG}
                max={RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG}
                step={1}
                value={thresholdValue}
                disabled={saving}
                aria-invalid={!thresholdValid}
                aria-describedby={["rubber-weight-alert-threshold-hint", errorDescription].filter(Boolean).join(" ")}
                onChange={(event) => {
                  setThresholdValue(event.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold" htmlFor="rubber-weight-alert-interval">
              รอบตรวจ (นาที)
              <input
                id="rubber-weight-alert-interval"
                type="number"
                inputMode="numeric"
                min={RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES}
                max={RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES}
                step={1}
                value={intervalValue}
                disabled={saving}
                aria-invalid={!intervalValid}
                aria-describedby={["rubber-weight-alert-interval-hint", errorDescription].filter(Boolean).join(" ")}
                onChange={(event) => {
                  setIntervalValue(event.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field"
              />
            </label>
          </div>
          <div className="grid gap-1 text-pretty text-sm text-ink/60 sm:grid-cols-2">
            <p id="rubber-weight-alert-threshold-hint">ตั้งได้ 1–1,000,000 กก. ค่าเริ่มต้น 10,000 กก.</p>
            <p id="rubber-weight-alert-interval-hint">ตั้งได้ 1–1,440 นาที ค่าเริ่มต้น 60 นาที</p>
          </div>
          {error && (
            <p id="rubber-weight-alert-error" role="alert" className="text-pretty rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-pretty rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              {success}
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !dirty}
            className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "บันทึกการแจ้งเตือน"}
          </button>
        </form>
      </div>
    </section>
  );
}
