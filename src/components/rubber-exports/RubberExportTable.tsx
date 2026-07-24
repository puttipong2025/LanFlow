import { Eye, Printer, Trash2 } from "lucide-react";
import type { RubberExportSummary, RubberExportStatus } from "@/types/rubber-exports";

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
  onOpen,
  onDelete,
}: {
  rows: RubberExportSummary[];
  loading: boolean;
  canDelete: boolean;
  onOpen: (id: string) => void;
  onDelete: (row: RubberExportSummary) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-mint/60 text-left text-ink">
          <tr>
            <th className="px-4 py-3">เลขที่</th>
            <th className="px-4 py-3">สถานะ</th>
            <th className="px-4 py-3 text-right">บิล</th>
            <th className="px-4 py-3 text-right">น้ำหนักเดิม</th>
            <th className="px-4 py-3 text-right">น้ำหนักปัจจุบัน</th>
            <th className="px-4 py-3 text-right">ยอดค่าทำงาน</th>
            <th className="px-4 py-3 text-right">การทำงาน</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {loading && (
            <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/60">กำลังโหลด...</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/60">ยังไม่มีรายการส่งออกยาง</td></tr>
          )}
          {!loading && rows.map((row) => (
            <tr key={row.id} className={row.status === "deleted" ? "bg-slate-50 text-ink/50" : ""}>
              <td className="px-4 py-3 font-semibold">{row.exportNo}</td>
              <td className="px-4 py-3">{statusLabel[row.status]}</td>
              <td className="px-4 py-3 text-right">{row.itemCount.toLocaleString("th-TH")}</td>
              <td className="px-4 py-3 text-right">{number(row.originalWeightTotal)}</td>
              <td className="px-4 py-3 text-right">{number(row.currentWeight)}</td>
              <td className="px-4 py-3 text-right">{number(row.workTotal)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="focus-ring inline-flex items-center gap-1 rounded-md bg-river px-3 py-1.5 font-semibold text-white"
                  >
                    <Eye size={15} /> ดู
                  </button>
                  {(row.status === "verified" || row.status === "deleted") && (
                    <a
                      href={`/rubber-exports/${row.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 font-semibold text-white"
                    >
                      <Printer size={15} /> พิมพ์
                    </a>
                  )}
                  {canDelete && row.status !== "deleted" && (
                    <button
                      type="button"
                      onClick={() => onDelete(row)}
                      disabled={Boolean(row.reportLockNo)}
                      title={row.reportLockNo
                        ? `ต้องลบรายงาน ${row.reportLockNo} ก่อน`
                        : "ลบรายการส่งออกยาง"}
                      className="focus-ring inline-flex items-center gap-1 rounded-md bg-clay px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Trash2 size={15} />
                      {row.reportLockNo ? `ล็อกโดย ${row.reportLockNo}` : "ลบ"}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

