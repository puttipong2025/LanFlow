"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Building2, Check, ChevronDown, Clock3, Wifi, WifiOff } from "lucide-react";
import type { Location, Profile } from "@/types";
import { canManageSystemFeatures } from "@/lib/permissions";
import { TelegramBadgeConfigModal } from "@/components/lanflow/TelegramBadgeConfigModal";
import { LogoutButton } from "@/components/lanflow/LogoutButton";
import { useDashboardBranchSummaries } from "@/hooks/useDashboardOverview";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { DashboardBranchCashStatus } from "@/types/dashboard";

const CASH_STATUS_LABELS: Record<DashboardBranchCashStatus, string> = {
  low: "ต่ำกว่าเกณฑ์",
  normal: "ปกติ",
  unconfigured: "ยังไม่ตั้งเกณฑ์",
  no_data: "ยังไม่มีข้อมูลภาพรวม",
};

function cashStatusColor(status?: DashboardBranchCashStatus) {
  if (status === "low") return "text-danger";
  if (status === "normal") return "text-success";
  return "text-ink/55";
}

function cashStatusDot(status?: DashboardBranchCashStatus) {
  if (status === "low") return "bg-danger";
  if (status === "normal") return "bg-success";
  return "bg-ink/30";
}

function formatCalculatedAt(value: string | null) {
  if (!value) return "ไม่ทราบเวลาข้อมูลล่าสุด";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatAveragePrice(value: number | null | undefined) {
  return value == null ? "—" : `฿${formatNumber(value)}/กก.`;
}

export function AppHeader({
  profile,
  locations,
  selectedLocationId,
  locationBadgeTotals,
  onLocationChange,
  onLogout,
  online,
  serviceUnavailable,
}: {
  profile: Profile;
  locations: Location[];
  selectedLocationId: string;
  locationBadgeTotals: Record<string, number>;
  onLocationChange: (locationId: string) => void;
  onLogout: () => void | Promise<void>;
  online: boolean;
  serviceUnavailable: boolean;
}) {
  const [telegramConfigOpen, setTelegramConfigOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  const branchSummaries = useDashboardBranchSummaries(profile.id, online);
  const { refetch: refetchBranchSummaries } = branchSummaries;
  const accessibleLocations = useMemo(
    () => locations.filter(
      (location) => location.active && profile.locationIds.includes(location.id)
    ),
    [locations, profile.locationIds],
  );
  const branchSummaryByLocation = useMemo(
    () => new Map(
      (branchSummaries.data ?? []).map((summary) => [summary.locationId, summary]),
    ),
    [branchSummaries.data],
  );
  const selectedLocation = accessibleLocations.find((location) => location.id === selectedLocationId);
  const selectedBadgeTotal = locationBadgeTotals[selectedLocationId] ?? 0;
  const selectedBranchSummary = branchSummaryByLocation.get(selectedLocationId);
  const selectedCashStatusLabel = selectedBranchSummary
    ? CASH_STATUS_LABELS[selectedBranchSummary.cashStatus]
    : null;

  function focusLocationOption(index: number) {
    requestAnimationFrame(() => {
      const options = locationMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]',
      );
      options?.[index]?.focus();
    });
  }

  useEffect(() => {
    if (!locationMenuOpen) return;
    const closeOnPointer = (event: MouseEvent) => {
      if (!locationMenuRef.current?.contains(event.target as Node)) {
        setLocationMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLocationMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [locationMenuOpen]);

  useEffect(() => {
    if (!online) setLocationMenuOpen(false);
  }, [online]);

  useEffect(() => {
    if (locationMenuOpen && online) void refetchBranchSummaries();
  }, [locationMenuOpen, online, refetchBranchSummaries]);

  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-leaf text-lg font-bold text-white shadow-sm">
              LF
            </div>
            <div>
              <h1 className="text-balance text-2xl font-bold text-ink">LanFlow</h1>
              <p className="text-pretty text-sm text-ink/60">{profile.name} · {profile.phone}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-bold ${
              online
                ? "bg-leaf/10 text-leaf"
                : "bg-amber/15 text-amber-800"
            }`}
          >
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}
            {online ? "ออนไลน์" : "ไม่มีอินเทอร์เน็ต"}
          </span>
          <div ref={locationMenuRef} className="relative min-w-0 sm:min-w-64">
            <button
              ref={locationButtonRef}
              type="button"
              data-location-id={selectedLocationId}
              data-cash-status={selectedBranchSummary?.cashStatus ?? "unknown"}
              aria-label={`เลือกสาขา${selectedBadgeTotal > 0 ? ` มีงาน ${selectedBadgeTotal} รายการ` : ""}${selectedCashStatusLabel ? ` สถานะ${selectedCashStatusLabel}` : ""}`}
              aria-haspopup="listbox"
              aria-controls="location-selector-listbox"
              aria-expanded={locationMenuOpen}
              aria-disabled={!online}
              disabled={!online}
              onClick={() => setLocationMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                setLocationMenuOpen(true);
                focusLocationOption(event.key === "ArrowDown" ? 0 : accessibleLocations.length - 1);
              }}
              className="focus-ring flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-left shadow-sm transition hover:border-leaf/35 hover:bg-mint/35 disabled:cursor-not-allowed disabled:bg-mint/30 disabled:opacity-65 disabled:hover:border-mint"
            >
              <Building2 size={18} className="shrink-0 text-leaf" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {selectedLocation?.name ?? "เลือกสาขา"}
              </span>
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${cashStatusDot(selectedBranchSummary?.cashStatus)}`}
              />
              {selectedBadgeTotal > 0 && (
                <span className="min-w-6 rounded-full bg-amber px-1.5 py-0.5 text-center text-[11px] font-extrabold leading-none text-white">
                  {selectedBadgeTotal > 99 ? "99+" : selectedBadgeTotal}
                </span>
              )}
              <ChevronDown size={16} className={`shrink-0 text-ink/45 transition ${locationMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {locationMenuOpen && (
              <div
                id="location-selector-listbox"
                role="listbox"
                aria-label="สาขาที่เข้าถึงได้"
                className="absolute right-0 top-full z-40 mt-2 max-h-72 w-[min(22.5rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-mint bg-white p-1.5 shadow-xl"
              >
                {accessibleLocations.map((location, index) => {
                  const active = location.id === selectedLocationId;
                  const badgeTotal = locationBadgeTotals[location.id] ?? 0;
                  const branchSummary = branchSummaryByLocation.get(location.id);
                  const cashStatus = branchSummary?.cashStatus;
                  const statusLabel = branchSummary
                    ? CASH_STATUS_LABELS[branchSummary.cashStatus]
                    : branchSummaries.isPending
                      ? "กำลังโหลดข้อมูลภาพรวม"
                      : branchSummaries.isError
                        ? "โหลดข้อมูลไม่ได้"
                        : "ยังไม่มีข้อมูลภาพรวม";
                  const dataIsStale = Boolean(
                    branchSummary?.summary &&
                    (branchSummary.snapshotStatus !== "ready" || branchSummaries.isError),
                  );
                  return (
                    <button
                      key={location.id}
                      type="button"
                      role="option"
                      data-location-id={location.id}
                      data-cash-status={cashStatus ?? "unknown"}
                      aria-selected={active}
                      onClick={() => {
                        onLocationChange(location.id);
                        setLocationMenuOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setLocationMenuOpen(false);
                          locationButtonRef.current?.focus();
                          return;
                        }
                        const nextIndex = event.key === "ArrowDown"
                          ? Math.min(index + 1, accessibleLocations.length - 1)
                          : event.key === "ArrowUp"
                            ? Math.max(index - 1, 0)
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? accessibleLocations.length - 1
                                : null;
                        if (nextIndex === null) return;
                        event.preventDefault();
                        focusLocationOption(nextIndex);
                      }}
                      className={cn(
                        "focus-ring flex w-full items-start gap-2 rounded-xl border px-3.5 py-3 text-left text-sm text-ink transition-colors",
                        active
                          ? "border-leaf/25 bg-mint/65 shadow-sm"
                          : "border-transparent hover:border-mint hover:bg-mint/40",
                      )}
                    >
                      <Check size={15} className={`mt-0.5 ${active ? "opacity-100 text-leaf" : "opacity-0"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-start gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold">{location.name}</span>
                          {badgeTotal > 0 && (
                            <span data-branch-badge className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-extrabold leading-none ${
                              active ? "bg-white text-leaf" : "bg-amber text-white"
                            }`}>
                              {badgeTotal > 99 ? "99+" : badgeTotal}
                            </span>
                          )}
                        </span>

                        {branchSummary?.summary ? (
                          <span className="mt-1.5 block space-y-1 text-xs">
                            <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <span className={`font-semibold ${cashStatusColor(cashStatus)}`}>
                                รับ–จ่ายสุทธิ {formatCurrency(branchSummary.summary.netCashFlow)}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 font-semibold ${
                                cashStatus === "low"
                                  ? "bg-danger/10 text-danger"
                                  : cashStatus === "normal"
                                    ? "bg-success/10 text-success"
                                    : "bg-ink/5 text-ink/55"
                              }`}>
                                {statusLabel}
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-1 text-pretty text-sm text-ink/60">
                              <span>
                                วันนี้ {formatNumber(branchSummary.summary.purchaseToday.billCount)} บิล · {formatNumber(branchSummary.summary.purchaseToday.netWeight)} กก. · เฉลี่ย {formatAveragePrice(branchSummary.summary.purchaseToday.averagePrice)}
                              </span>
                              {dataIsStale && (
                                <span
                                  role="img"
                                  aria-label={`ข้อมูลไม่สด ข้อมูลล่าสุด ${formatCalculatedAt(branchSummary.calculatedAt)}`}
                                  title={`ข้อมูลล่าสุด ${formatCalculatedAt(branchSummary.calculatedAt)}`}
                                  className="inline-flex items-center"
                                >
                                  <Clock3 size={12} />
                                </span>
                              )}
                            </span>
                            <span className="block font-semibold text-ink/70">
                              นน.ยางคงเหลือ {formatNumber(branchSummary.summary.rubberInventoryWeight)} กก.
                            </span>
                          </span>
                        ) : branchSummaries.isPending ? (
                          <span className="mt-1.5 block text-xs text-ink/45">{statusLabel}</span>
                        ) : (
                          <span className="mt-1.5 block space-y-1 text-xs text-ink/50">
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <span>รับ–จ่ายสุทธิ —</span>
                              <span className="rounded-full bg-ink/5 px-2 py-0.5 font-semibold">
                                {statusLabel}
                              </span>
                            </span>
                            <span className="mt-1 block text-pretty text-sm text-ink/60">
                              วันนี้ — บิล · — กก. · เฉลี่ย —
                            </span>
                            <span className="block">นน.ยางคงเหลือ —</span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {canManageSystemFeatures(profile) && (
            <button
              type="button"
              onClick={() => setTelegramConfigOpen(true)}
              className="focus-ring flex items-center justify-center gap-1.5 rounded-lg bg-telegram px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-telegram/90"
              title="ตั้งค่าการแจ้งเตือน Telegram"
              aria-label="ตั้งค่าการแจ้งเตือน Telegram"
            >
              <BellRing size={16} />
              <span>Telegram</span>
            </button>
          )}

          <LogoutButton online={online} onLogout={onLogout} />
        </div>
      </div>
      {online && serviceUnavailable && (
        <p
          role="status"
          className="border-t border-amber/20 bg-amber/10 px-4 py-2 text-center text-sm font-semibold text-amber-900"
        >
          เชื่อมต่อระบบไม่ได้ กำลังแสดงข้อมูลล่าสุด
        </p>
      )}

      {telegramConfigOpen && (
        <TelegramBadgeConfigModal
          selectedLocationId={selectedLocationId}
          onDashboardConfigSaved={() => void refetchBranchSummaries()}
          onClose={() => setTelegramConfigOpen(false)}
        />
      )}
    </>
  );
}
