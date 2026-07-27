import { Loader2, WifiOff } from "lucide-react";
import { type Tab, tabs } from "@/components/lanflow/tabs";
import type { Profile } from "@/types";
import type { UploadItem } from "@/components/OcrTicketUpload";
import type { ModuleBadgeCounts } from "@/hooks/useActionableBadges";
import { canManageSystemFeatures, canUseMoneyTransfer, canUseReports } from "@/lib/permissions";
import { getOfflineTabBlockMessage } from "@/lib/offline-module-policy";
import { getOcrActionState } from "@/lib/ocr-action-state";

export function NavigationTabs({
  activeTab,
  onTabChange,
  profile,
  ocrUploadItems,
  moduleBadgeCounts,
  online
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  profile: Profile;
  ocrUploadItems: UploadItem[];
  moduleBadgeCounts: ModuleBadgeCounts;
  online: boolean;
}) {
  const {
    actionableCount: ocrActionableCount,
    processingCount: ocrProcessing,
    errorCount: ocrError,
  } = getOcrActionState(ocrUploadItems);

  return (
    <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-3 pb-3 sm:px-4">
      {tabs.filter(tab => {
        if (tab.id === "admin") return canManageSystemFeatures(profile) || ["super_admin", "admin"].includes(profile.role);
        if (tab.id === "money-transfer") return canUseMoneyTransfer(profile);
        if (tab.id === "reports" || tab.id === "rubber-export") return canUseReports(profile);
        return true;
      }).map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        const isOcrTab = tab.id === "ocr";
        const badgeCount = online
          ? (moduleBadgeCounts[tab.id] ?? 0) + (isOcrTab ? ocrActionableCount : 0)
          : 0;
        const offlineBlockMessage = online ? null : getOfflineTabBlockMessage(tab.id);
        const isOfflineBlocked = Boolean(offlineBlockMessage);

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            disabled={isOfflineBlocked}
            title={offlineBlockMessage ?? tab.label}
            aria-label={badgeCount > 0 ? `${tab.label} มีงานที่จัดการได้ ${badgeCount} รายการ` : tab.label}
            className={`focus-ring relative flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
              isOfflineBlocked
                ? "cursor-not-allowed bg-slate-200 text-ink/45"
                : active
                  ? "bg-leaf text-white"
                  : "bg-actionSecondary text-white hover:bg-actionSecondary/90"
            }`}
          >
            <Icon size={17} />
            {tab.label}
            {isOfflineBlocked && <WifiOff size={13} />}
            {online && isOcrTab && ocrProcessing > 0 && (
              <span title="กำลังประมวลผล OCR" aria-label="กำลังประมวลผล OCR">
                <Loader2 size={10} className="animate-spin" />
              </span>
            )}
            {badgeCount > 0 && (
              <span
                className={`ml-0.5 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none ${
                  isOcrTab && ocrError > 0
                    ? "bg-clay text-white"
                    : "bg-amber text-white"
                }`}
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
