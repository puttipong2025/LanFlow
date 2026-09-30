import { useEffect, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { authFetch } from "@/lib/auth-fetch";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { formatDailyWageCurrency, formatPayrollCurrency } from "@/lib/time-tracking/format";

function auditActionLabel(action: string) {
  return action === "RECALCULATE_WAGE_DEDUCTIONS"
    ? "แก้ค่าแรงและคำนวณยอดหักใหม่"
    : action;
}

function auditDataLabel(action: string, data: any) {
  if (!data) return "-";
  if (action !== "RECALCULATE_WAGE_DEDUCTIONS") return JSON.stringify(data);
  return `${formatDailyWageCurrency(Number(data.dailyWage) || 0)} · ยอดหัก ${formatPayrollCurrency(Number(data.totalDeduction) || 0)}`;
}

export function AuditLogsModal({ adminId, adminName, onClose }: { adminId: string, adminName: string, onClose: () => void }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoadError(null);
      try {
        const res = await authFetch("/api/lanflow/time-tracking/admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'GET_AUDIT_LOGS', payload: { admin_user_id: adminId } }),
        });
        if (!res.ok) throw new Error("โหลดประวัติไม่สำเร็จ");
        const json = await res.json();
        if (!active) return;
        setLogs(json.logs || []);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load time/payroll audit logs:", error);
        setLoadError("โหลดประวัติไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [adminId]);

  return (
    <ModalShell
      title={`ประวัติการกระทำของ Admin: ${adminName}`}
      onClose={onClose}
      nativeModal
      closeOnEscape
      size="wide"
    >
      <div className="p-3 sm:p-4" aria-busy={loading}>
        {loading ? (
           <div>กำลังโหลดข้อมูล...</div>
        ) : loadError ? (
           <div role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm font-semibold text-danger">{loadError}</div>
        ) : logs.length === 0 ? (
           <div className="text-ink/50">ไม่มีประวัติ</div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-black/10 text-ink/65">
                <th className="pb-3 font-semibold">เวลา</th>
                <th className="pb-3 font-semibold">Action</th>
                <th className="pb-3 font-semibold">ข้อมูลเดิม</th>
                <th className="pb-3 font-semibold">ข้อมูลใหม่</th>
                <th className="pb-3 font-semibold">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-sand/30">
                  <td className="py-3">{formatBangkokDateTime(log.created_at)}</td>
                  <td className="py-3 font-bold text-river">{auditActionLabel(log.action)}</td>
                  <td className="max-w-[180px] truncate py-3 text-xs text-ink/60" title={JSON.stringify(log.old_data)}>{auditDataLabel(log.action, log.old_data)}</td>
                  <td className="max-w-[180px] truncate py-3 text-xs text-ink/60" title={JSON.stringify(log.new_data)}>{auditDataLabel(log.action, log.new_data)}</td>
                  <td className="py-3 text-ink/80 truncate max-w-[150px]" title={log.comment}>{log.comment || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  )
}

