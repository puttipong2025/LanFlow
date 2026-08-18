import { Edit3, Eye, Images, Share2, Trash2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { RubberBill } from "@/types";
import { formatBillTimestamp, getDisplayBillNo } from "./bill-display";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";
import { TablePagination } from "@/components/shared/TablePagination";
import { cn } from "@/lib/cn";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";
import type { EvidenceReviewState } from "@/hooks/useRubberBillEvidenceReview";

export type RubberBillsTableProps = {
  bills: RubberBill[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onView: (bill: RubberBill) => void;
  onEvidence: (bill: RubberBill) => void;
  onEdit: (bill: RubberBill) => void;
  onDelete: (bill: RubberBill) => void;
  onPrint: (bill: RubberBill) => void;
  onRetry: (bill: RubberBill) => void;
  retryDisabled: boolean;
  deletingBillId?: string | null;
  getActionBlockReason?: (bill: RubberBill) => string | null;
  getPrintBlockReason?: (bill: RubberBill) => string | null;
  evidenceStatesByBillId: Map<string, EvidenceReviewState>;
  evidenceOnline: boolean;
};

const evidenceStatusLabel = {
  outside: "นอกช่วงตรวจ",
  normal: "หลักฐานครบ",
  pending: "รอตรวจหลักฐาน",
  pass: "ผ่าน",
  improve: "ควรปรับปรุง",
} as const;

const evidenceStatusClass = {
  outside: "bg-slate-100 text-slate-600",
  normal: "bg-mint text-ink",
  pending: "bg-amber-100 text-amber-800",
  pass: "bg-green-100 text-green-800",
  improve: "bg-red-100 text-red-800",
} as const;

export function RubberBillsTable({
  bills,
  page,
  pageSize,
  onPageChange,
  onView,
  onEvidence,
  onEdit,
  onDelete,
  onPrint,
  onRetry,
  retryDisabled,
  deletingBillId,
  getActionBlockReason,
  getPrintBlockReason,
  evidenceStatesByBillId,
  evidenceOnline,
}: RubberBillsTableProps) {
  const totalPages = Math.max(Math.ceil(bills.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleBills = bills.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1480px] border-collapse text-sm">
          <thead>
            <tr className="whitespace-nowrap border-b border-black/20 text-left text-ink">
              <th className="py-2">จัดการ</th>
              <th>เลขที่บิล</th>
              <th>วันที่ออกบิล</th>
              <th>TimestampBill</th>
              <th>ชื่อลูกค้า</th>
              <th>ผู้รับผิดชอบการจ่าย</th>
              <th>ประเภทบิล</th>
              <th>น้ำหนักสุทธิ</th>
              <th>มูลค่ายาง (บาท)</th>
              <th>ราคาเฉลี่ย</th>
              <th>ยอดหักเงิน</th>
              <th>ยอดที่ต้องจ่ายลูกค้า</th>
              <th>สถานะหลักฐาน</th>
              <th>Sync</th>
            </tr>
          </thead>
          <tbody>
            {visibleBills.map((bill) => {
              const actionBlockReason = getActionBlockReason?.(bill) ?? null;
              const deleting = deletingBillId === bill.id;
              const actionsDisabled = Boolean(actionBlockReason) || deleting;
              const actionTitle = deleting ? "กำลังลบรายการ..." : actionBlockReason;
              const viewDisabled = deleting || (!bill.sourceRubberExportId && Boolean(actionBlockReason));
              const viewTitle = deleting ? "กำลังลบรายการ..." : "ดูรายละเอียด";
              const printBlockReason = getPrintBlockReason?.(bill) ?? null;
              const evidenceState = evidenceStatesByBillId.get(bill.id);
              const evidenceDisabled = !evidenceOnline
                || bill.syncStatus !== "synced"
                || bill.id.startsWith("approval:")
                || !evidenceState
                || evidenceState.reviewStatus === "outside";
              const evidenceButtonLabel = evidenceState?.reviewStatus === "pass"
                ? "ดูหลักฐาน · ผ่าน"
                : evidenceState?.reviewStatus === "improve"
                  ? "ดูหลักฐาน · ควรปรับปรุง"
                  : "เปิดหลักฐาน";
              const evidenceDisabledLabel = !evidenceOnline
                ? "เปิดหลักฐานได้เมื่อออนไลน์เท่านั้น"
                : bill.syncStatus !== "synced"
                  ? "รอซิงก์บิลก่อนเปิดหลักฐาน"
                  : "บิลนี้อยู่นอกขอบเขตรอบตรวจ";

              return (
              <tr key={bill.id} className="whitespace-nowrap border-b border-black/10 hover:bg-field/50">
                <td className="py-3">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <button
                      type="button"
                       title={viewTitle}
                       aria-label={viewTitle}
                      disabled={viewDisabled}
                       onClick={() => onView(bill)}
                        className={cn("focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white shadow-sm hover:bg-river/90", viewDisabled && "cursor-not-allowed opacity-45")}
                    >
                       <Eye size={17} />
                    </button>
                    {!bill.id.startsWith("approval:") && <button
                      type="button"
                      title={evidenceDisabled ? evidenceDisabledLabel : evidenceButtonLabel}
                      aria-label={evidenceDisabled ? evidenceDisabledLabel : "เปิดหลักฐานน้ำหนัก"}
                      disabled={evidenceDisabled}
                      onClick={() => onEvidence(bill)}
                      className={cn(
                        "focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-settings px-3 text-sm font-semibold text-white shadow-sm hover:bg-settings/90",
                        evidenceDisabled && "cursor-not-allowed opacity-45",
                      )}
                    >
                      <Images size={16} /> {evidenceButtonLabel}
                    </button>}
                    <button type="button" title={printBlockReason ?? "แชร์ PDF ใบรับซื้อยาง"} aria-label={printBlockReason ?? "แชร์ PDF ใบรับซื้อยาง"}
                      disabled={Boolean(printBlockReason)} onClick={() => onPrint(bill)}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90 ${printBlockReason ? "cursor-not-allowed opacity-45" : ""}`}>
                      <Share2 size={16} /> แชร์ PDF
                    </button>
                    {!bill.sourceRubberExportId && <button
                      type="button"
                       title={actionTitle ?? "แก้ไข"}
                       aria-label={actionTitle ?? "แก้ไข"}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(bill)}
                       className={cn("focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-amber px-3 text-sm font-semibold text-white shadow-sm hover:bg-amber/90", actionsDisabled && "cursor-not-allowed opacity-45")}
                    >
                      <Edit3 size={16} />
                       แก้
                    </button>}
                    <button type="button" title={actionTitle ?? "ลบ"} aria-label={actionTitle ?? "ลบ"}
                      disabled={actionsDisabled} onClick={() => onDelete(bill)}
                      className={`focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-sm font-semibold text-white shadow-sm hover:bg-danger/90 ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}>
                      <Trash2 size={16} /> ลบ
                    </button>
                    {bill.syncStatus === "failed" && (
                      <button
                        type="button"
                        onClick={() => onRetry(bill)}
                        disabled={retryDisabled}
                        className="rounded-md bg-river px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        ลองซิงก์อีกครั้ง
                      </button>
                    )}
                  </div>
                </td>
                <td className="font-semibold">
                  <div className="flex flex-col gap-1">
                    <span>{getDisplayBillNo(bill)}</span>
                    {!bill.serverBillNo && <span className="text-xs font-normal text-ink/55">{bill.localBillNo}</span>}
                    {bill.approvalPending && (
                      <span
                        className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"
                        title={bill.approvalReasons?.map((reason) => {
                          if (reason === "price") return "ราคาเกินเพดาน";
                          if (reason === "non_current_date") return "วันที่ไม่ใช่วันปัจจุบัน";
                          return "พ้นเวลาที่กำหนด";
                        }).join(", ")}
                      >
                        รออนุมัติ{bill.approvalOperation === "create" ? "สร้างบิล" : ""}
                        {bill.approvalReasons?.length
                          ? ` · ${bill.approvalReasons.map((reason) => {
                            if (reason === "price") return "ราคา";
                            if (reason === "non_current_date") return "วันที่";
                            return "เวลา";
                          }).join("+")}`
                          : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td>{bill.billDate}</td>
                <td>{formatBillTimestamp(bill.clientCreatedAt)}</td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <span>{bill.customerName}</span>
                    {bill.sourceRubberExportId && (
                      <>
                        <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-bold text-ink">รับจากสาขา</span>
                        <span className="text-xs text-ink/60 tabular-nums">
                          อายุตอนรับ {formatRubberAge(bill.receivedAgeHours ?? null)}
                          {bill.receivedAgeIsEstimated ? " · ประมาณการ" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td>{bill.createdByName?.trim() || "ไม่ระบุ"}</td>
                <td>{bill.billType}</td>
                <td>{formatNumber(bill.netWeight)}</td>
                <td>{formatNumber(bill.rubberValue)}</td>
                <td>{formatNumber(bill.price)}</td>
                <td>{formatNumber(bill.deductionTotal)}</td>
                <td>{formatNumber(bill.netTotal)}</td>
                <td>
                  {evidenceState ? (
                    <span className={cn("rounded-full px-2 py-1 text-xs font-bold", evidenceStatusClass[evidenceState.reviewStatus])}>
                      {evidenceStatusLabel[evidenceState.reviewStatus]}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      {bill.syncStatus === "synced" ? "กำลังตรวจสถานะ" : "รอซิงก์"}
                    </span>
                  )}
                </td>
                <td>
                  {bill.approvalPending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">รออนุมัติ</span>
                  ) : (
                    <SyncStatusBadge status={bill.syncStatus} errorMessage={bill.syncErrorMessage} />
                  )}
                </td>
              </tr>
              );
            })}
            {visibleBills.length === 0 && (
              <tr>
                <td colSpan={14} className="py-8 text-center text-ink/50">
                  ยังไม่มีบิลในสาขานี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        totalItems={bills.length}
        page={currentPage}
        pageSize={pageSize}
        onPageChange={onPageChange}
      />
    </>
  );
}
