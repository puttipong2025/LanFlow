import { Edit3, Eye, Share2, Trash2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { RubberBill } from "@/types";
import { formatBillTimestamp, getDisplayBillNo } from "./bill-display";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";

export type RubberBillsTableProps = {
  bills: RubberBill[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onEdit: (bill: RubberBill) => void;
  onDelete: (bill: RubberBill) => void;
  onPrint: (bill: RubberBill) => void;
  onRetry: (bill: RubberBill) => void;
  retryDisabled: boolean;
  getActionBlockReason?: (bill: RubberBill) => string | null;
  getPrintBlockReason?: (bill: RubberBill) => string | null;
};

export function RubberBillsTable({
  bills,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onDelete,
  onPrint,
  onRetry,
  retryDisabled,
  getActionBlockReason,
  getPrintBlockReason
}: RubberBillsTableProps) {
  const totalPages = Math.max(Math.ceil(bills.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleBills = bills.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstVisible = bills.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, bills.length);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] border-collapse text-sm">
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
              <th>Sync</th>
            </tr>
          </thead>
          <tbody>
            {visibleBills.map((bill) => {
              const actionBlockReason = getActionBlockReason?.(bill) ?? null;
              const actionsDisabled = Boolean(actionBlockReason);
              const printBlockReason = getPrintBlockReason?.(bill) ?? null;

              return (
              <tr key={bill.id} className="whitespace-nowrap border-b border-black/10 hover:bg-field/50">
                <td className="py-3">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <button
                      type="button"
                       title={actionBlockReason ?? "ดูรายละเอียด"}
                       aria-label={actionBlockReason ?? "ดูรายละเอียด"}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(bill)}
                       className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-white shadow-sm hover:bg-river/90 ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                       <Eye size={17} />
                    </button>
                    <button type="button" title={printBlockReason ?? "แชร์ PDF ใบรับซื้อยาง"} aria-label={printBlockReason ?? "แชร์ PDF ใบรับซื้อยาง"}
                      disabled={Boolean(printBlockReason)} onClick={() => onPrint(bill)}
                      className={`inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90 ${printBlockReason ? "cursor-not-allowed opacity-45" : ""}`}>
                      <Share2 size={16} /> แชร์ PDF
                    </button>
                    <button
                      type="button"
                       title={actionBlockReason ?? "แก้ไข"}
                       aria-label={actionBlockReason ?? "แก้ไข"}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(bill)}
                      className={`focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-amber px-3 text-sm font-semibold text-white shadow-sm hover:bg-amber/90 ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <Edit3 size={16} />
                       แก้
                    </button>
                    <button type="button" title={actionBlockReason ?? "ลบ"} aria-label={actionBlockReason ?? "ลบ"}
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
                <td>{bill.customerName}</td>
                <td>{bill.createdByName?.trim() || "ไม่ระบุ"}</td>
                <td>{bill.billType}</td>
                <td>{formatNumber(bill.netWeight)}</td>
                <td>{formatNumber(bill.rubberValue)}</td>
                <td>{formatNumber(bill.price)}</td>
                <td>{formatNumber(bill.deductionTotal)}</td>
                <td>{formatNumber(bill.netTotal)}</td>
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
                <td colSpan={13} className="py-8 text-center text-ink/50">
                  ยังไม่มีบิลในสาขานี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-ink">
          <p>แสดง {firstVisible} ถึง {lastVisible} จาก {bills.length} แถว</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 7).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`h-10 min-w-10 rounded-md border px-3 text-sm font-semibold text-white ${
                currentPage === pageNumber ? "border-leaf bg-leaf" : "border-actionSecondary bg-actionSecondary hover:bg-actionSecondary/90"
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
