"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import type {
  TelegramBadgeConfig,
  TelegramBadgeKey,
} from "@/lib/telegram-badge";

type EditableConfig = TelegramBadgeConfig & {
  botToken: string;
};

function parseError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "errorMessage" in payload &&
    typeof payload.errorMessage === "string"
  ) {
    return payload.errorMessage;
  }
  return fallback;
}

export function TelegramBadgeConfigModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [config, setConfig] = useState<EditableConfig | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "test" | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/lanflow/telegram-badge/config", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(parseError(payload, "โหลดการตั้งค่าไม่สำเร็จ"));
        }
        if (active) setConfig({ ...payload, botToken: "" });
      })
      .catch((error) => {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : "โหลดการตั้งค่าไม่สำเร็จ",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function patchConfig(patch: Partial<EditableConfig>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleBadge(key: TelegramBadgeKey) {
    if (!config) return;
    const nextKeys = config.enabledBadgeKeys.includes(key)
      ? config.enabledBadgeKeys.filter((item) => item !== key)
      : [...config.enabledBadgeKeys, key];
    patchConfig({ enabledBadgeKeys: nextKeys });
  }

  async function saveConfig() {
    if (!config) throw new Error("ยังโหลดการตั้งค่าไม่สำเร็จ");
    const response = await fetch("/api/lanflow/telegram-badge/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: config.enabled,
        chatId: config.chatId,
        startTime: config.startTime,
        endTime: config.endTime,
        intervalMinutes: config.intervalMinutes,
        enabledBadgeKeys: config.enabledBadgeKeys,
        botToken: config.botToken,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(parseError(payload, "บันทึกการตั้งค่าไม่สำเร็จ"));
    }
    setConfig({ ...payload, botToken: "" });
  }

  async function handleSave() {
    setBusyAction("save");
    try {
      await saveConfig();
      toast.success("บันทึกการแจ้งเตือน Telegram แล้ว");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTest() {
    setBusyAction("test");
    try {
      await saveConfig();
      const response = await fetch("/api/lanflow/telegram-badge/test", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(parseError(payload, "ส่งข้อความทดสอบไม่สำเร็จ"));
      }
      toast.success("ส่งข้อความทดสอบแล้ว");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ส่งข้อความทดสอบไม่สำเร็จ",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <ModalShell
      title="ตั้งค่าการแจ้งเตือน Telegram"
      subtitle="ส่งสรุปจำนวนงานที่รอหรือค้างไปยังห้องกลางของระบบ"
      onClose={onClose}
    >
      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      ) : !config ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink/60">
          <LoaderCircle className="animate-spin" size={18} />
          กำลังโหลดการตั้งค่า
        </div>
      ) : (
        <div className="space-y-5">
          <label className="flex items-center justify-between gap-4 rounded-md border border-black/10 bg-field p-4">
            <span>
              <span className="block text-sm font-bold text-ink">
                เปิดใช้การแจ้งเตือน
              </span>
              <span className="block text-xs text-ink/60">
                เมื่อเปิด ระบบจะเริ่มตรวจรอบแรกหลัง 10 นาที
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => patchConfig({ enabled: event.target.checked })}
              className="h-5 w-5 accent-leaf"
            />
          </label>

          <h3 className="text-sm font-bold text-ink">Telegram</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold text-ink">
              Bot Token
              <input
                type="password"
                autoComplete="new-password"
                value={config.botToken}
                onChange={(event) => patchConfig({ botToken: event.target.value })}
                placeholder={
                  config.tokenConfigured
                    ? "ตั้งค่าแล้ว — เว้นว่างเพื่อใช้ Token เดิม"
                    : "Token จาก BotFather"
                }
                className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
              />
            </label>
            <label className="space-y-1 text-sm font-semibold text-ink">
              Chat ID
              <input
                type="text"
                value={config.chatId}
                onChange={(event) => patchConfig({ chatId: event.target.value })}
                placeholder="เช่น -1001234567890"
                className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
              />
            </label>
          </div>

          <h3 className="text-sm font-bold text-ink">ตารางเวลา</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-ink">
              เวลาเริ่ม
              <input
                type="time"
                value={config.startTime}
                onChange={(event) => patchConfig({ startTime: event.target.value })}
                className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-ink">
              เวลาสิ้นสุด
              <input
                type="time"
                value={config.endTime}
                onChange={(event) => patchConfig({ endTime: event.target.value })}
                className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-ink">
              ระยะห่าง (นาที)
              <input
                type="number"
                min={10}
                max={240}
                step={1}
                value={config.intervalMinutes}
                onChange={(event) =>
                  patchConfig({ intervalMinutes: Number(event.target.value) })
                }
                className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
              />
            </label>
          </div>

          <fieldset className="rounded-md border border-black/10 p-4">
            <legend className="px-1 text-sm font-bold text-ink">
              Badge ที่ต้องการส่ง
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {config.catalog.map((item) => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-center gap-3 rounded-md bg-field px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={config.enabledBadgeKeys.includes(item.key)}
                    onChange={() => toggleBadge(item.key)}
                    className="h-4 w-4 accent-leaf"
                  />
                  <span>
                    <span className="font-semibold">{item.moduleLabel}</span>
                    <span className="text-ink/55"> · {item.statusLabel}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-xs text-ink/55">
            ส่งเฉพาะชื่อสาขา ชื่อโมดูล สถานะ และจำนวน ไม่มีข้อมูลรายบุคคล
            หากไม่มีรายการจะไม่ส่งข้อความ
          </p>

          <section className="rounded-md border border-black/10 bg-field p-4">
            <h3 className="text-sm font-bold text-ink">ผลการทำงานล่าสุด</h3>
            <dl className="mt-2 grid gap-2 text-xs text-ink/65 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink/80">ส่งสำเร็จล่าสุด</dt>
                <dd>
                  {config.lastSuccessAt
                    ? new Date(config.lastSuccessAt).toLocaleString("th-TH")
                    : "ยังไม่มี"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink/80">ตรวจล่าสุด</dt>
                <dd>
                  {config.lastAttemptAt
                    ? new Date(config.lastAttemptAt).toLocaleString("th-TH")
                    : "ยังไม่มี"}
                </dd>
              </div>
              {config.lastError && (
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-red-700">ข้อผิดพลาดล่าสุด</dt>
                  <dd className="text-red-700">{config.lastError}</dd>
                </div>
              )}
            </dl>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-black/10 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busyAction !== null}
              className="focus-ring rounded-md border border-black/15 px-4 py-2 text-sm font-semibold text-ink/70 disabled:opacity-50"
            >
              ปิด
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={busyAction !== null}
              className="focus-ring flex items-center justify-center gap-2 rounded-md border border-river px-4 py-2 text-sm font-semibold text-river disabled:opacity-50"
            >
              {busyAction === "test" ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              ทดสอบการส่ง
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busyAction !== null}
              className="focus-ring flex items-center justify-center gap-2 rounded-md bg-leaf px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busyAction === "save" && (
                <LoaderCircle className="animate-spin" size={16} />
              )}
              บันทึก
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
