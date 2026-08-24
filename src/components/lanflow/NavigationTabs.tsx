import { Link2, WifiOff } from "lucide-react";
import { type Tab, tabs } from "@/components/lanflow/tabs";
import type { Profile } from "@/types";
import type { ModuleBadgeCounts } from "@/hooks/useActionableBadges";
import { canManageSystemFeatures, canUseMoneyTransfer, canUseReports } from "@/lib/permissions";
import { getOfflineTabBlockMessage } from "@/lib/offline-module-policy";

export function NavigationTabs({
  activeTab,
  onTabChange,
  profile,
  moduleBadgeCounts,
  online
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  profile: Profile;
  moduleBadgeCounts: ModuleBadgeCounts;
  online: boolean;
}) {
  return (
    <nav className="mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-3 pb-4 sm:flex-wrap sm:overflow-visible sm:px-4">
      {tabs.filter(tab => {
        if (tab.id === "admin") return canManageSystemFeatures(profile) || ["super_admin", "admin"].includes(profile.role);
        if (tab.id === "money-transfer") return canUseMoneyTransfer(profile);
        if (tab.id === "reports" || tab.id === "rubber-export") return canUseReports(profile);
        return true;
      }).map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        const badgeCount = online ? (moduleBadgeCounts[tab.id] ?? 0) : 0;
        const offlineBlockMessage = online ? null : getOfflineTabBlockMessage(tab.id);
        const isOfflineBlocked = Boolean(offlineBlockMessage);
        const isReportPair = tab.id === "reports" || tab.id === "cash-count";
        const isRubberPair = tab.id === "rubber" || tab.id === "rubber-evidence";
        const relationTitle = tab.id === "reports"
          ? "เชื่อมกับโมดูลนับเงิน"
          : tab.id === "cash-count"
            ? "เชื่อมกับโมดูลรายงาน"
            : tab.id === "rubber"
              ? "เชื่อมกับโมดูลตรวจหลักฐาน"
              : tab.id === "rubber-evidence"
                ? "เชื่อมกับโมดูลบิลยาง"
            : null;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            disabled={isOfflineBlocked}
            title={offlineBlockMessage ?? (relationTitle ? `${tab.label} · ${relationTitle}` : tab.label)}
            aria-label={badgeCount > 0 ? `${tab.label} มีงานที่จัดการได้ ${badgeCount} รายการ` : tab.label}
            aria-pressed={active}
            className={`focus-ring relative flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold shadow-sm ${
              isOfflineBlocked
                ? "cursor-not-allowed border-black/5 bg-field text-ink/40 shadow-none"
                : active
                  ? "border-leaf bg-leaf text-white"
                  : isReportPair || isRubberPair
                    ? "border-leaf/25 bg-mint/30 text-ink/80 hover:border-leaf/40 hover:bg-mint/50 hover:text-leaf"
                    : "border-mint bg-white text-ink/75 hover:border-leaf/30 hover:bg-mint/40 hover:text-ink"
            }`}
          >
            <Icon size={17} />
            {tab.label}
            {(isReportPair || isRubberPair) && (
              <Link2
                size={12}
                aria-hidden="true"
                className={active ? "text-white/80" : "text-leaf/65"}
              />
            )}
            {isOfflineBlocked && <WifiOff size={13} />}
            {badgeCount > 0 && (
              <span
                className="ml-0.5 min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white"
                title={`${badgeCount} งานที่จัดการได้`}
              >
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
