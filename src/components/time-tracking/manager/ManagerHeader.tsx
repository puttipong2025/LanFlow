import type { RefObject } from "react";
import { Clock } from "lucide-react";
import type { TimePayrollSettingsDto } from "@/lib/time-tracking/attendance-contract";
import { TimePayrollConfigPanel } from "../settings/TimePayrollConfigPanel";

export function ManagerHeader({ settings, canEditGlobalConfig, online, attendanceSaving, onSave, canViewAudit, admins, auditLogsTriggerRef, onOpenAudit }: {
  settings?: TimePayrollSettingsDto; canEditGlobalConfig: boolean; online: boolean; attendanceSaving: boolean;
  onSave: (time: string) => Promise<boolean>; canViewAudit: boolean; admins?: any[];
  auditLogsTriggerRef: RefObject<HTMLSelectElement | null>; onOpenAudit: (id: string) => void;
}) {
  return (
         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
           <h2 className="flex items-center gap-2 text-balance text-xl font-bold text-ink">
             <Clock /> จัดการเวลาและเงินเดือน
           </h2>
         <div className="flex flex-wrap gap-2">
           {settings && (
             <TimePayrollConfigPanel
               settings={settings}
               canConfigure={canEditGlobalConfig}
               online={online}
               saving={attendanceSaving}
               onSave={onSave}
             />
           )}
           {canViewAudit && admins && admins.length > 0 && (
             <select
               ref={auditLogsTriggerRef}
               aria-label="ดูประวัติของแอดมิน"
               className="text-sm bg-ink/5 px-3 py-1.5 rounded-md hover:bg-ink/10 font-semibold border border-black/10 outline-none focus:border-river focus:ring-1 focus:ring-river cursor-pointer"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onOpenAudit(e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="">ดูประวัติของแอดมิน...</option>
              {admins.map((admin: any) => (
                <option key={admin.id} value={admin.id}>
                  ประวัติของ {admin.name}
                </option>
              ))}
            </select>
          )}
        </div>
        </div>
  );
}

