import { Clock3, Eye, Loader2, PackageCheck, Pencil, Share2, ShoppingCart, Trash2, Undo2 } from "lucide-react";
import type { RubberExportSummary, RubberExportStatus } from "@/types/rubber-exports";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";

const statusLabel: Record<RubberExportStatus, string> = {
  draft: "ฉบับร่าง",
  verified: "ตรวจสอบแล้ว",
};

function number(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function RubberExportTable({
  rows,
  loading,
  online,
  canDelete,
  canVerify,
  shareBusy,
  sharingId,
  onOpen,
  onEdit,
  onSale,
  onShare,
  onDelete,
}: {
  rows: RubberExportSummary[];
  loading: boolean;
  online: boolean;
  canDelete: boolean;
  canVerify: boolean;
  shareBusy: boolean;
  sharingId: string | null;
  onOpen: (id: string) => void;
  onEdit: (row: RubberExportSummary) => void;
  onSale: (row: RubberExportSummary, soldOut: boolean) => void;
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
            <th className="px-4 py-3">ผู้สร้าง</th>
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
            <tr><td colSpan={10} className="px-4 py-8 text-center text-ink/60">กำลังโหลด...</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-ink/60">ยังไม่มีรายการส่งออกยาง</td></tr>
          )}
          {!loading && rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <button type="button" onClick={() => onOpen(row.id)} disabled={!online} title={online ? "ดูรายละเอียด" : "ต้องออนไลน์ก่อนดูรายละเอียด"} aria-label={`ดูรายละเอียด ${row.exportNo}`}
                    className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white disabled:cursor-not-allowed disabled:opacity-45">
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
                  {row.status === "draft" && (
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      disabled={!online}
                      title={online ? "แก้รายการส่งออกยาง" : "ต้องออนไลน์ก่อนแก้รายการ"}
                      className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-river px-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Pencil size={16} /> แก้
                    </button>
                  )}
                  {row.status === "verified" && (
                    <button type="button" onClick={() => onShare(row)} disabled={!online || shareBusy}
                      title={`แชร์ PDF รายการส่งออกยาง ${row.exportNo}`} aria-label={`แชร์ PDF รายการส่งออกยาง ${row.exportNo}`}
                      className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-ink px-3 font-semibold text-white disabled:opacity-50">
                      {sharingId === row.id ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                      {sharingId === row.id ? "กำลังสร้าง PDF" : "แชร์ PDF"}
                    </button>
                  )}
                  {row.status === "verified" && !row.receiptBillNo && (
                    <button
                      type="button"
                      onClick={() => onSale(row, !row.soldOutAt)}
                      disabled={!online || Boolean(row.soldOutAt && row.hasWexReservation)}
                      title={row.soldOutAt && row.hasWexReservation
                        ? "รายการนี้ถูกจองในบิลรถส่งออก จึงยกเลิกขายไม่ได้"
                        : online ? (row.soldOutAt ? "ยกเลิกขาย" : "ขายยางออก") : "ต้องออนไลน์ก่อนเปลี่ยนสถานะขาย"}
                      className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-river px-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {row.soldOutAt ? <Undo2 size={16} /> : <ShoppingCart size={16} />}
                      {row.soldOutAt ? "ยกเลิกขาย" : "ขายยางออก"}
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" onClick={() => onDelete(row)} disabled={Boolean(row.reportLockNo || row.receiptBillNo || row.soldOutAt)}
                      title={row.soldOutAt
                        ? "กรุณายกเลิกขายก่อนลบรายการ"
                        : row.receiptBillNo
                        ? `รับเข้าแล้วที่ ${row.receiptLocationName} · ${row.receiptBillNo} ต้องลบบิลรับก่อน`
                        : row.reportLockNo ? `ต้องลบรายงาน ${row.reportLockNo} ก่อน` : "ลบรายการส่งออกยาง"}
                      aria-label={row.soldOutAt
                        ? "กรุณายกเลิกขายก่อนลบรายการ"
                        : row.receiptBillNo
                        ? `รับเข้าแล้วที่ ${row.receiptLocationName} · ${row.receiptBillNo} ต้องลบบิลรับก่อน`
                        : row.reportLockNo ? `ต้องลบรายงาน ${row.reportLockNo} ก่อน` : "ลบรายการส่งออกยาง"}
                      className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                      <Trash2 size={16} /> ลบ
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-semibold tabular-nums">{row.exportNo}</td>
              <td className="px-4 py-3">
                <div>{statusLabel[row.status]}</div>
                {row.receiptBillNo && (
                  <div className="mt-1 w-fit rounded-full bg-mint px-2 py-0.5 text-xs font-semibold text-ink">
                    รับเข้าแล้วที่ {row.receiptLocationName} · {row.receiptBillNo}
                  </div>
                )}
                {row.soldOutAt && (
                  <div className="mt-1 w-fit rounded-full bg-amber px-2 py-0.5 text-xs font-semibold text-white">
                    ขายออกแล้ว · {row.soldOutByName || "—"} · <span className="tabular-nums">{dateTime(row.soldOutAt)}</span>
                  </div>
                )}
              </td>
              <td className="px-4 py-3">{row.createdByName || "—"}</td>
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
