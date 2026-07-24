"use client";

import { useState } from "react";
import { BellRing, Building2, LogOut } from "lucide-react";
import type { Location, Profile } from "@/types";
import { canManageSystemFeatures } from "@/lib/permissions";
import { TelegramBadgeConfigModal } from "@/components/lanflow/TelegramBadgeConfigModal";

export function AppHeader({
  profile,
  locations,
  selectedLocationId,
  onLocationChange,
  onLogout
}: {
  profile: Profile;
  locations: Location[];
  selectedLocationId: string;
  onLocationChange: (locationId: string) => void;
  onLogout: () => void;
}) {
  const [telegramConfigOpen, setTelegramConfigOpen] = useState(false);

  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-leaf text-lg font-bold text-white">
              LF
            </div>
            <div>
              <h1 className="text-2xl font-bold text-ink">LanFlow</h1>
              <p className="text-sm text-ink/65">{profile.name} · {profile.phone}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex min-w-0 items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2">
            <Building2 size={18} className="shrink-0 text-leaf" />
            <select
              className="focus-ring w-full bg-transparent text-sm font-semibold text-ink"
              value={selectedLocationId}
              onChange={(event) => onLocationChange(event.target.value)}
              aria-label="เลือกสาขา"
            >
              {locations
                .filter((location) => profile.locationIds.includes(location.id))
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </label>

          {canManageSystemFeatures(profile) && (
            <button
              type="button"
              onClick={() => setTelegramConfigOpen(true)}
              className="focus-ring flex items-center justify-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink/70 transition-colors hover:bg-field hover:text-river"
              title="ตั้งค่าการแจ้งเตือน Telegram"
              aria-label="ตั้งค่าการแจ้งเตือน Telegram"
            >
              <BellRing size={16} />
              <span className="hidden md:inline">Telegram</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="focus-ring flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-ink/70 transition-colors hover:bg-red-50 hover:text-red-600"
            title="ออกจากระบบ"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </div>
      </div>

      {telegramConfigOpen && (
        <TelegramBadgeConfigModal
          onClose={() => setTelegramConfigOpen(false)}
        />
      )}
    </>
  );
}
