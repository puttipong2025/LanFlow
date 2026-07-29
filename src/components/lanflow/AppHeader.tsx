"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Building2, Check, ChevronDown } from "lucide-react";
import type { Location, Profile } from "@/types";
import { canManageSystemFeatures } from "@/lib/permissions";
import { TelegramBadgeConfigModal } from "@/components/lanflow/TelegramBadgeConfigModal";
import { LogoutButton } from "@/components/lanflow/LogoutButton";

export function AppHeader({
  profile,
  locations,
  selectedLocationId,
  locationBadgeTotals,
  onLocationChange,
  onLogout,
  online,
}: {
  profile: Profile;
  locations: Location[];
  selectedLocationId: string;
  locationBadgeTotals: Record<string, number>;
  onLocationChange: (locationId: string) => void;
  onLogout: () => void | Promise<void>;
  online: boolean;
}) {
  const [telegramConfigOpen, setTelegramConfigOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  const accessibleLocations = useMemo(
    () => locations.filter((location) => profile.locationIds.includes(location.id)),
    [locations, profile.locationIds],
  );
  const selectedLocation = accessibleLocations.find((location) => location.id === selectedLocationId);
  const selectedBadgeTotal = locationBadgeTotals[selectedLocationId] ?? 0;

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
          <div ref={locationMenuRef} className="relative min-w-0 sm:min-w-64">
            <button
              ref={locationButtonRef}
              type="button"
              data-location-id={selectedLocationId}
              aria-label={`เลือกสาขา${selectedBadgeTotal > 0 ? ` มีงาน ${selectedBadgeTotal} รายการ` : ""}`}
              aria-haspopup="listbox"
              aria-controls="location-selector-listbox"
              aria-expanded={locationMenuOpen}
              onClick={() => setLocationMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                setLocationMenuOpen(true);
                focusLocationOption(event.key === "ArrowDown" ? 0 : accessibleLocations.length - 1);
              }}
              className="focus-ring flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-mint bg-white px-3 text-left shadow-sm transition hover:border-leaf/35 hover:bg-mint/35"
            >
              <Building2 size={18} className="shrink-0 text-leaf" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {selectedLocation?.name ?? "เลือกสาขา"}
              </span>
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
                className="absolute left-0 right-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-xl border border-mint bg-white p-1.5 shadow-xl"
              >
                {accessibleLocations.map((location, index) => {
                  const active = location.id === selectedLocationId;
                  const badgeTotal = locationBadgeTotals[location.id] ?? 0;
                  return (
                    <button
                      key={location.id}
                      type="button"
                      role="option"
                      data-location-id={location.id}
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
                      className={`focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                        active ? "bg-leaf text-white" : "text-ink hover:bg-mint"
                      }`}
                    >
                      <Check size={15} className={active ? "opacity-100" : "opacity-0"} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{location.name}</span>
                      {badgeTotal > 0 && (
                        <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-extrabold leading-none ${
                          active ? "bg-white text-leaf" : "bg-amber text-white"
                        }`}>
                          {badgeTotal > 99 ? "99+" : badgeTotal}
                        </span>
                      )}
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

      {telegramConfigOpen && (
        <TelegramBadgeConfigModal
          selectedLocationId={selectedLocationId}
          onClose={() => setTelegramConfigOpen(false)}
        />
      )}
    </>
  );
}
