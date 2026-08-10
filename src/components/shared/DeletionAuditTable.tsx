import type { DocumentDeletionAudit } from "@/types/deletion-audits";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function previousStatus(value: DocumentDeletionAudit["previousStatus"]) {
  if (value === "draft") return "ฉบับร่าง";
  if (value === "verified") return "ตรวจสอบแล้ว";
  return "—";
}

export function DeletionAuditTable({
  rows,
  loading,
  emptyLabel,
  onShowCurrent,
  showPreviousStatus = false,
  originalActorLabel,
}: {
  rows: DocumentDeletionAudit[];
  loading: boolean;
  emptyLabel: string;
  onShowCurrent: () => void;
  showPreviousStatus?: boolean;
  originalActorLabel?: string;
}) {
  const columns = 4 + Number(showPreviousStatus) + Number(Boolean(originalActorLabel));

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm tabular-nums">
          <thead className="bg-mint/60 text-left text-ink">
            <tr>
              <th className="px-4 py-3">เลขเอกสาร</th>
              <th className="px-4 py-3">สาขา</th>
              {showPreviousStatus && <th className="px-4 py-3">สถานะก่อนลบ</th>}
              {originalActorLabel && <th className="px-4 py-3">{originalActorLabel}</th>}
              <th className="px-4 py-3">ผู้ลบ</th>
              <th className="px-4 py-3">เวลาลบ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {loading && (
              <tr>
                <td colSpan={columns} className="px-4 py-8 text-center text-ink/60">
                  กำลังโหลดประวัติการลบ...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-4 py-8 text-center">
                  <p className="text-pretty text-ink/60">{emptyLabel}</p>
                  <button
                    type="button"
                    onClick={onShowCurrent}
                    className="focus-ring mt-3 rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white"
                  >
                    กลับรายการปัจจุบัน
                  </button>
                </td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-semibold">{row.documentNo}</td>
                <td className="px-4 py-3">{row.locationName}</td>
                {showPreviousStatus && (
                  <td className="px-4 py-3">{previousStatus(row.previousStatus)}</td>
                )}
                {originalActorLabel && (
                  <td className="px-4 py-3">{row.originalActorName || "—"}</td>
                )}
                <td className="px-4 py-3">{row.deletedByName}</td>
                <td className="whitespace-nowrap px-4 py-3">{dateTime(row.deletedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
