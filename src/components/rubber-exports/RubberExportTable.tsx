import { Clock3, Eye, Loader2, PackageCheck, Share2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RubberExportSummary, RubberExportStatus } from "@/types/rubber-exports";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";

const statusLabel: Record<RubberExportStatus, string> = {
  draft: "ฉบับร่าง",
  verified: "ตรวจสอบแล้ว",
  deleted: "ลบแล้ว",
};

function number(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RubberExportTable({
  rows,
  loading,
  canDelete,
  canVerify,
  shareBusy,
  sharingId,
  onOpen,
  onShare,
  onDelete,
}: {
  rows: RubberExportSummary[];
  loading: boolean;
  canDelete: boolean;
  canVerify: boolean;
  shareBusy: boolean;
  sharingId: string | null;
  onOpen: (id: string) => void;
  onShare: (row: RubberExportSummary) => void;
  onDelete: (row: RubberExportSummary) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-mint/60 text-left text-ink">
          <tr>
            <th className="px-4 py-3">จัดการ</th>
            <th className="px-4 py-3">เลขที่</th>
            <th className="px-4 py-3">สถานะ</th>
            <th className="px-4 py-3 text-right">บิล</th>
            <th className="px-4 py-3 text-right">น้ำหนักเดิม</th>
            <th className="px-4 py-3 text-right">น้ำหนักปัจจุบัน</th>
            <th className="px-4 py-3 text-right">ยอดค่าทำงาน</th>
            <th className="px-4 py-3 text-right">อายุเฉลี่ย</th>
            <th className="px-4 py-3 text-right">อายุมากสุด</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {loading && (
            <tr><td colSpan={9} className="px-4 py-8 text-center text-ink/60">กำลังโหลด...</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={9} className="px-4 py-8 text-center text-ink/60">ยังไม่มีรายการส่งออกยาง</td></tr>
          )}
          {!loading && rows.map((row) => (
            <tr key={row.id} className={cn(row.status === "deleted" && "bg-slate-50 text-ink/50")}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <button type="button" onClick={() => onOpen(row.id)} title="ดูรายละเอียด" aria-label={`ดูรายละเอียด ${row.exportNo}`}
                    className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white">
                    <Eye size={17} />
                  </button>
                  {row.status === "draft" && (canVerify ? (
                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-leaf px-3 font-semibold text-white"
                    >
                      <PackageCheck size={16} /> เปิดตรวจสอบ
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="รอ super_admin หรือผู้มีสิทธิ์จัดการระบบตรวจสอบรายการ"
                      className="inline-flex h-10 cursor-not-allowed items-center gap-1.5 rounded-md bg-slate-200 px-3 font-semibold text-ink/60"
                    >
                      <Clock3 size={16} /> รอผู้รับรอง
                    </button>
                  ))}
                  {(row.status === "verified" || row.status === "deleted") && (
                    <button type="button" onClick={() => onShare(row)} disabled={shareBusy}
                      title={`แชร์ PDF รายการส่งออกยาง ${row.exportNo}`} aria-label={`แชร์ PDF รายการส่งออกยาง ${row.exportNo}`}
                      className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-ink px-3 font-semibold text-white disabled:opacity-50">
                      {sharingId === row.id ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                      {sharingId === row.id ? "กำลังสร้าง PDF" : "แชร์ PDF"}
                    </button>
                  )}
                  {canDelete && row.status !== "deleted" && (
                    <button type="button" onClick={() => onDelete(row)} disabled={Boolean(row.reportLockNo)}
                      title={row.reportLockNo ? `ต้องลบรายงาน ${row.reportLockNo} ก่อน` : "ลบรายการส่งออกยาง"}
                      aria-label={row.reportLockNo ? `ต้องลบรายงาน ${row.reportLockNo} ก่อน` : "ลบรายการส่งออกยาง"}
                      className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                      <Trash2 size={16} /> ลบ
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-semibold tabular-nums">{row.exportNo}</td>
              <td className="px-4 py-3">{statusLabel[row.status]}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.itemCount.toLocaleString("th-TH")}</td>
              <td className="px-4 py-3 text-right tabular-nums">{number(row.originalWeightTotal)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{number(row.currentWeight)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{number(row.workTotal)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatRubberAge(row.averageAgeHours)}
                {Boolean(row.estimatedAgeItemCount) && <div className="text-xs text-amber-800">ประมาณการ {row.estimatedAgeItemCount} บิล</div>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatRubberAge(row.oldestAgeHours)}
                {Boolean(row.estimatedAgeItemCount) && <div className="text-xs text-amber-800">ประมาณการ {row.estimatedAgeItemCount} บิล</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
