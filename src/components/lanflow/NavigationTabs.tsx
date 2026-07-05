import { CheckCircle2, Loader2 } from "lucide-react";
import { type Tab, tabs } from "@/components/lanflow/tabs";
import type { Profile } from "@/types";
import type { UploadItem } from "@/components/OcrTicketUpload";

export function NavigationTabs({
  activeTab,
  onTabChange,
  profile,
  ocrUploadItems,
  transferPartialCount,
  transferAdvanceCount,
  timeTrackingPendingCount
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  profile: Profile;
  ocrUploadItems: UploadItem[];
  transferPartialCount: number;
  transferAdvanceCount: number;
  timeTrackingPendingCount: number;
}) {
  return (
    <nav className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 pb-3 sm:flex-nowrap sm:overflow-x-auto">
      {tabs.filter(tab => tab.id !== "admin" || ["super_admin", "admin"].includes(profile.role)).map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        const ocrProcessing = ocrUploadItems.filter((i) => i.status === "processing").length;
        const ocrPending = ocrUploadItems.filter((i) => i.status === "pending").length;
        const ocrSuccess = ocrUploadItems.filter((i) => i.status === "success").length;
        const ocrError = ocrUploadItems.filter((i) => i.status === "error").length;
        const showOcrBadge = tab.id === "ocr" && ocrUploadItems.length > 0;

        const isTransferTab = tab.id === "money-transfer";
        const isTimeTrackingTab = tab.id === "time-tracking";

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`focus-ring relative flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
              active ? "bg-leaf text-white" : "bg-white text-ink hover:bg-mint"
            }`}
          >
            <Icon size={17} />
            {tab.label}
            {showOcrBadge && ocrProcessing > 0 && (
              <span className="ml-1 flex items-center gap-0.5 rounded-full bg-river px-1.5 py-0.5 text-[10px] font-bold text-white">
                <Loader2 size={10} className="animate-spin" />
                {ocrProcessing}
              </span>
            )}
            {showOcrBadge && ocrProcessing === 0 && ocrPending > 0 && (
              <span className="ml-1 rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold text-ink">
                {ocrPending}
              </span>
            )}
            {showOcrBadge && ocrProcessing === 0 && ocrPending === 0 && ocrSuccess > 0 && ocrError === 0 && (
              <span className="ml-1 flex items-center gap-0.5 rounded-full bg-leaf/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                <CheckCircle2 size={10} />
                {ocrSuccess}
              </span>
            )}
            {showOcrBadge && ocrError > 0 && ocrProcessing === 0 && (
              <span className="ml-1 rounded-full bg-clay px-1.5 py-0.5 text-[10px] font-bold text-white">
                {ocrError}
              </span>
            )}
            {isTransferTab && transferPartialCount > 0 && (
              <span className="ml-1 flex items-center gap-0.5 rounded-full bg-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-800" title="ค้างจ่าย">
                {transferPartialCount}
              </span>
            )}
            {isTransferTab && transferAdvanceCount > 0 && (
              <span className="ml-1 flex items-center gap-0.5 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-700" title="จ่ายล่วงหน้า">
                {transferAdvanceCount}
              </span>
            )}
            {isTimeTrackingTab && timeTrackingPendingCount > 0 && (
              <span className="ml-1 flex items-center gap-0.5 rounded-full bg-amber px-1.5 py-0.5 text-[10px] font-bold text-ink" title="รออนุมัติ">
                {timeTrackingPendingCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
