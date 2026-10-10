import { Check, X } from "lucide-react";

import { ApprovalOperationBadge } from "@/components/income-expense/ApprovalOperationBadge";
import { formatDateTime, formatPerson } from "@/components/income-expense/approval-display";
import { formatCurrency } from "@/lib/format";
import type { BranchTransferDeleteRequest } from "@/types";

const statusLabels = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
} as const;

export function BranchTransferDeleteApprovalRow({
  request,
  isDeciding,
  onDecision,
}: {
  request: BranchTransferDeleteRequest;
  isDeciding: boolean;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
}) {
  const statusClass = request.requestStatus === "pending"
    ? "bg-amber-100 text-amber-700"
    : request.requestStatus === "approved" ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay";
  return (
    <tr id={`income-expense-approval-request-${request.id}`} tabIndex={-1} className="border-b border-black/5">
      <td className="py-3 pr-3">
        {request.requestStatus === "pending" && <div className="flex gap-1.5 whitespace-nowrap">
          <button type="button" disabled={isDeciding} onClick={() => onDecision(request.id, "approved")} className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-success text-white disabled:opacity-50" title="อนุมัติการลบ" aria-label="อนุมัติการลบรายการโอนเข้าบัญชี"><Check size={17} /></button>
          <button type="button" disabled={isDeciding} onClick={() => onDecision(request.id, "rejected")} className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-clay text-white disabled:opacity-50" title="ปฏิเสธการลบ" aria-label="ปฏิเสธการลบรายการโอนเข้าบัญชี"><X size={17} /></button>
        </div>}
      </td>
      <td><div className="flex flex-wrap items-center gap-2"><ApprovalOperationBadge operation="delete" /><span className="font-semibold text-ink">{request.transferDisplayNo}</span></div></td>
      <td className="font-semibold text-clay">{formatCurrency(request.amount)}</td>
      <td>{formatDateTime(request.createdAt)}</td>
      <td className="py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusClass}`}>{statusLabels[request.requestStatus]}</span></td>
      <td className="whitespace-nowrap">{formatPerson(request.requestedByName, request.requestedByPhone)}</td>
      <td className="whitespace-nowrap">{formatPerson(request.decidedByName, request.decidedByPhone)}</td>
      <td>ลบรายการโอนเข้าบัญชี</td>
      <td>{request.locationName}</td>
      <td>ลบหลังสาขายืนยันรับ</td>
    </tr>
  );
}
