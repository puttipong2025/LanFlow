import { Banknote, ClipboardList, Edit3 } from "lucide-react";
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
              <th className="py-2">Delete/Edit/View</th>
              <th>เลขที่บิล</th>
              <th>วันที่ออกบิล</th>
              <th>TimestampBill</th>
              <th>ชื่อลูกค้า</th>
              <th>ผู้รับผิดชอบการจ่าย</th>
              <th>ประเภทบิล</th>
              <th>น้ำหนักที่หัก</th>
              <th>น้ำหนักรวม</th>
              <th>รวมมูลค่ายาง(บาท)</th>
              <th>ราคาเฉลี่ย</th>
              <th>ยอดรวมที่ถูกหัก</th>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title={actionBlockReason ?? "ดู"}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(bill)}
                      className={`grid h-7 w-7 place-items-center rounded-full bg-leaf text-sm font-bold text-white ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      title={actionBlockReason ?? "ลบ"}
                      disabled={actionsDisabled}
                      onClick={() => onDelete(bill)}
                      className={`rounded-md bg-rose-500 px-3 py-1 text-sm font-bold text-white ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      ลบ
                    </button>
                    <button
                      type="button"
                      title={actionBlockReason ?? "แก้ไข"}
                      disabled={actionsDisabled}
                      onClick={() => onEdit(bill)}
                      className={`grid h-8 w-8 place-items-center rounded-md bg-field text-ink ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      type="button"
                      title={printBlockReason ?? (bill.printStatus === "ปริ้นแล้ว" ? "พิมพ์ซ้ำ (สถานะ: ปริ้นแล้ว)" : "พิมพ์บิล")}
                      disabled={Boolean(printBlockReason)}
                      onClick={() => onPrint(bill)}
                      className={`grid h-8 w-8 place-items-center rounded-md ${
                        bill.printStatus === "ปริ้นแล้ว" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"
                      } ${printBlockReason ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <ClipboardList size={16} />
                    </button>
                    <button
                      type="button"
                      title={actionBlockReason ?? "จ่ายเงิน"}
                      disabled={actionsDisabled}
                      className={`grid h-8 w-10 place-items-center rounded-md bg-amber text-ink ${actionsDisabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <Banknote size={18} />
                    </button>
                    {bill.syncStatus === "failed" && (
                      <button
                        type="button"
                        onClick={() => onRetry(bill)}
                        disabled={retryDisabled}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
                        title={bill.approvalReasons?.map((reason) => reason === "price" ? "ราคาไม่ตรง" : "พ้นเวลาที่กำหนด").join(", ")}
                      >
                        รออนุมัติ{bill.approvalOperation === "create" ? "สร้างบิล" : ""}
                        {bill.approvalReasons?.length
                          ? ` · ${bill.approvalReasons.map((reason) => reason === "price" ? "ราคา" : "เวลา").join("+")}`
                          : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td>{bill.billDate}</td>
                <td>{formatBillTimestamp(bill.clientCreatedAt)}</td>
                <td>{bill.customerName}</td>
                <td>{bill.customerType}</td>
                <td>{bill.billType}</td>
                <td>{formatNumber(bill.deductWeight)}</td>
                <td>{formatNumber(bill.weight)}</td>
                <td>{formatNumber(bill.netTotal + bill.deductionTotal)}</td>
                <td>{formatNumber(bill.price)}</td>
                <td>{formatNumber(bill.deductionTotal)}</td>
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
        <div className="space-y-2 text-sm text-ink">
          <p>แสดง {firstVisible} ถึง {lastVisible} จาก {bills.length} แถว</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-leaf px-3 py-2 text-sm font-bold text-white">
              ข้อมูลทั้งหมด
            </button>
            <button type="button" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              เปิดกรองข้อมูล
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 7).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`h-10 min-w-10 rounded-md border px-3 text-sm font-semibold ${
                currentPage === pageNumber ? "border-black/20 bg-field text-ink" : "border-transparent bg-white text-ink"
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
