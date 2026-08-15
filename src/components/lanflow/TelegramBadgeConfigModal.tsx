"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import type {
  TelegramBadgeConfig,
  TelegramBadgeKey,
} from "@/lib/telegram-badge";
import type { DashboardManagerConfig } from "@/types/dashboard";
import { formatCurrency, formatNumber } from "@/lib/format";
import { authFetch } from "@/lib/auth-fetch";
import { isNetworkCancellation } from "@/lib/network-abort";
import { formatBangkokDateTime } from "@/lib/bangkok-date";

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
  onDashboardConfigSaved,
  selectedLocationId,
}: {
  onClose: () => void;
  onDashboardConfigSaved: () => void;
  selectedLocationId: string;
}) {
  const [config, setConfig] = useState<EditableConfig | null>(null);
  const [dashboardConfig, setDashboardConfig] =
    useState<DashboardManagerConfig | null>(null);
  const [dashboardLocationId, setDashboardLocationId] =
    useState(selectedLocationId);
  const [busyAction, setBusyAction] = useState<"save" | "test" | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    void authFetch("/api/lanflow/telegram-badge/config", { cache: "no-store" })
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

  useEffect(() => {
    let active = true;
    setDashboardConfig(null);
    const params = new URLSearchParams({ locationId: dashboardLocationId });
    void authFetch(`/api/lanflow/dashboard/config?${params}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(parseError(payload, "โหลดเกณฑ์ Dashboard ไม่สำเร็จ"));
        }
        if (active) setDashboardConfig(payload);
      })
      .catch((error) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "โหลดเกณฑ์ Dashboard ไม่สำเร็จ",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [dashboardLocationId]);

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
    if (!dashboardConfig) throw new Error("ยังโหลดเกณฑ์ Dashboard ไม่สำเร็จ");

    const dashboardParams = new URLSearchParams({
      locationId: dashboardLocationId,
    });
    const dashboardResponse = await authFetch(
      `/api/lanflow/dashboard/config?${dashboardParams}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId: dashboardLocationId,
          intervalMinutes: dashboardConfig.intervalMinutes,
          purchaseAverageMin:
            dashboardConfig.thresholds.purchaseAverageMin,
          netCashMin: dashboardConfig.thresholds.netCashMin,
          stockItems: dashboardConfig.thresholds.stockItems.map((item) => ({
            productId: item.productId,
            minimumBalance: item.minimumBalance,
          })),
        }),
      },
    );
    const dashboardPayload = await dashboardResponse.json();
    if (!dashboardResponse.ok) {
      throw new Error(
        parseError(dashboardPayload, "บันทึกเกณฑ์ Dashboard ไม่สำเร็จ"),
      );
    }
    setDashboardConfig(dashboardPayload);
    onDashboardConfigSaved();

    const response = await authFetch("/api/lanflow/telegram-badge/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: config.enabled,
        chatId: config.chatId,
        startTime: config.startTime,
        endTime: config.endTime,
        intervalMinutes: config.intervalMinutes,
        evidenceEnabled: config.evidenceEnabled,
        evidenceIntervalMinutes: config.evidenceIntervalMinutes,
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
      if (!isNetworkCancellation(error)) {
        toast.error(
          error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ",
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTest() {
    setBusyAction("test");
    try {
      await saveConfig();
      const response = await authFetch("/api/lanflow/telegram-badge/test", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(parseError(payload, "ส่งข้อความทดสอบไม่สำเร็จ"));
      }
      toast.success("ส่งข้อความทดสอบแล้ว");
    } catch (error) {
      if (!isNetworkCancellation(error)) {
        toast.error(
          error instanceof Error ? error.message : "ส่งข้อความทดสอบไม่สำเร็จ",
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <ModalShell
      title="ตั้งค่าการแจ้งเตือน Telegram"
      subtitle="ส่งเฉพาะงานค้างหรือค่า Dashboard ที่ต่ำกว่าเกณฑ์"
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
              เกณฑ์ Dashboard แยกต่อสาขา
            </legend>
            {!dashboardConfig ? (
              <div className="flex items-center gap-2 py-5 text-sm text-ink/55">
                <LoaderCircle className="animate-spin" size={16} />
                กำลังโหลดการ์ด
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-ink">
                  สาขา
                  <select
                    value={dashboardLocationId}
                    onChange={(event) =>
                      setDashboardLocationId(event.target.value)
                    }
                    className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal"
                  >
                    {dashboardConfig.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 lg:grid-cols-3">
                  <section className="rounded-md bg-field p-3">
                    <p className="text-xs font-bold text-ink/60">
                      ยอดซื้อเฉลี่ย 7 วัน
                    </p>
                    <p className="mt-1 text-lg font-bold text-ink">
                      {dashboardConfig.snapshot.summary
                        ? formatCurrency(
                            dashboardConfig.snapshot.summary.purchase7Days
                              .dailyAverage,
                          )
                        : "กำลังคำนวณ"}
                    </p>
                    <label className="mt-2 block text-xs font-semibold">
                      แจ้งเมื่อยอดต่ำกว่า (บาท/วัน)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={
                          dashboardConfig.thresholds.purchaseAverageMin
                        }
                        onChange={(event) =>
                          setDashboardConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  thresholds: {
                                    ...current.thresholds,
                                    purchaseAverageMin: Number(
                                      event.target.value,
                                    ),
                                  },
                                }
                              : current,
                          )
                        }
                        className="focus-ring mt-1 h-9 w-full rounded-md border border-black/15 bg-white px-2"
                      />
                    </label>
                  </section>

                  <section className="rounded-md bg-field p-3">
                    <p className="text-xs font-bold text-ink/60">
                      รับ–จ่ายสุทธิสะสม
                    </p>
                    <p className="mt-1 text-lg font-bold text-ink">
                      {dashboardConfig.snapshot.summary
                        ? formatCurrency(
                            dashboardConfig.snapshot.summary.netCashFlow,
                          )
                        : "กำลังคำนวณ"}
                    </p>
                    <label className="mt-2 block text-xs font-semibold">
                      แจ้งเมื่อยอดต่ำกว่า (บาท)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={dashboardConfig.thresholds.netCashMin}
                        onChange={(event) =>
                          setDashboardConfig((current) =>
                            current
                              ? {
                                  ...current,
                                  thresholds: {
                                    ...current.thresholds,
                                    netCashMin: Number(event.target.value),
                                  },
                                }
                              : current,
                          )
                        }
                        className="focus-ring mt-1 h-9 w-full rounded-md border border-black/15 bg-white px-2"
                      />
                    </label>
                  </section>

                  <section className="rounded-md bg-field p-3">
                    <p className="text-xs font-bold text-ink/60">
                      สต็อกสินค้า
                    </p>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                      {dashboardConfig.thresholds.stockItems.map((item) => {
                        const balance =
                          dashboardConfig.snapshot.summary?.stock.items.find(
                            (stockItem) =>
                              stockItem.productId === item.productId,
                          )?.balance;
                        return (
                          <label
                            key={item.productId}
                            className="block text-xs font-semibold"
                          >
                            {item.name} · ปัจจุบัน{" "}
                            {balance == null
                              ? "—"
                              : `${formatNumber(balance)} ${item.unit}`}
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={item.minimumBalance ?? ""}
                              placeholder="ไม่แจ้ง"
                              onChange={(event) => {
                                const value =
                                  event.target.value === ""
                                    ? null
                                    : Number(event.target.value);
                                setDashboardConfig((current) =>
                                  current
                                    ? {
                                        ...current,
                                        thresholds: {
                                          ...current.thresholds,
                                          stockItems:
                                            current.thresholds.stockItems.map(
                                              (stockItem) =>
                                                stockItem.productId ===
                                                item.productId
                                                  ? {
                                                      ...stockItem,
                                                      minimumBalance: value,
                                                    }
                                                  : stockItem,
                                            ),
                                        },
                                      }
                                    : current,
                                );
                              }}
                              className="focus-ring mt-1 h-9 w-full rounded-md border border-black/15 bg-white px-2"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                </div>
                <p className="text-xs text-ink/55">
                  ตรวจตามรอบ Telegram · สถานะปกติไม่ส่งข้อความ
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="rounded-md border border-black/10 p-4">
            <legend className="px-1 text-sm font-bold text-ink text-balance">
              หลักฐานน้ำหนัก
            </legend>
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-md bg-field p-3">
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    ส่งสรุป Evidence
                  </span>
                  <span className="block text-xs text-ink/60 text-pretty">
                    ส่งเฉพาะจำนวนแก้ด้วยมือและหลักฐานที่ยังไม่ครบ
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={config.evidenceEnabled}
                  onChange={(event) =>
                    patchConfig({ evidenceEnabled: event.target.checked })
                  }
                  className="h-5 w-5 accent-leaf"
                />
              </label>
              <label className="block text-sm font-semibold text-ink">
                ระยะห่าง Evidence (นาที)
                <input
                  type="number"
                  min={30}
                  max={1440}
                  step={1}
                  value={config.evidenceIntervalMinutes}
                  onChange={(event) =>
                    patchConfig({
                      evidenceIntervalMinutes: Number(event.target.value),
                    })
                  }
                  className="focus-ring mt-1 h-10 w-full rounded-md border border-black/15 bg-white px-3 font-normal tabular-nums"
                />
              </label>
              <p className="text-xs text-ink/55 text-pretty">
                ใช้ปลายทางและช่วงเวลาเดียวกับ Telegram หลัก และจะเริ่มในรอบถัดไป
              </p>
            </div>
          </fieldset>

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
                    ? formatBangkokDateTime(config.lastSuccessAt)
                    : "ยังไม่มี"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink/80">ตรวจล่าสุด</dt>
                <dd>
                  {config.lastAttemptAt
                    ? formatBangkokDateTime(config.lastAttemptAt)
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

          <div className="modal-actions flex flex-col-reverse gap-2 border-t border-black/10 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busyAction !== null}
              className="focus-ring rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50"
            >
              ปิด
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={busyAction !== null}
              className="focus-ring flex items-center justify-center gap-2 rounded-md bg-telegram px-4 py-2 text-sm font-semibold text-white hover:bg-telegram/90 disabled:opacity-50"
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
              className="focus-ring flex items-center justify-center gap-2 rounded-md bg-commit px-4 py-2 text-sm font-semibold text-white hover:bg-commit/90 disabled:opacity-50"
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
