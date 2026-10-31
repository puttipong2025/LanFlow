import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatApprovalAmount as formatCurrency } from "./approval-display";
import type { CashTransferDeleteRequest, BranchTransferDeleteRequest, IncomeExpenseApprovalRequest, QueueOperation } from "@/types";
import { ApprovalOperationBadge } from "./ApprovalOperationBadge";
import { formatDateTime, formatPerson, reasonLabels, statusLabels } from "./approval-display";

function ApprovalRow({ id, title, status, operation, amount, income, createdAt, location, requester, decider, reason, type, busy, children, onApprove, onReject }: {
  id: string; title: string; status: IncomeExpenseApprovalRequest["requestStatus"]; operation: QueueOperation;
  amount: number; income?: boolean; createdAt: string; location: string; requester: string; decider: string;
  reason: string; type: string; busy: boolean; children?: ReactNode; onApprove: () => void; onReject: () => void;
}) {
  return (
    <tr id={`income-expense-approval-request-${id}`} tabIndex={-1} aria-label={`คำขอ ${title}`}
      className="focus-ring border-b border-black/5 align-top text-ink last:border-b-0 hover:bg-field/30" aria-busy={busy}>
      <td className="px-0.5 py-2 sm:px-3">
        {status === "pending" ? <div className="flex flex-col gap-1 sm:flex-row">
          <button type="button" aria-label="อนุมัติ" title="อนุมัติ" disabled={busy} onClick={onApprove} className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-success text-white disabled:opacity-50"><Check size={18} aria-hidden="true" /></button>
          <button type="button" aria-label="ปฏิเสธ" title="ปฏิเสธ" disabled={busy} onClick={onReject} className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-clay text-white disabled:opacity-50"><X size={18} aria-hidden="true" /></button>
        </div> : <span className="text-ink/45">—</span>}
      </td>
      <th scope="row" className="px-1 py-2 text-left font-normal sm:px-3">
        <div className="mb-1 flex flex-wrap items-center gap-1.5"><ApprovalOperationBadge operation={operation} /><span className="text-xs text-ink/60">{type}</span></div>
        <p className="break-words text-pretty font-semibold">{title}</p>
        <p className="mt-0.5 break-words text-pretty text-xs text-ink/60">สาขา: {location}</p>
        {children && <div className="mt-1 break-words text-pretty text-xs text-ink/70">{children}</div>}
      </th>
      <td className={cn("break-all px-1 py-2 text-right font-semibold tabular-nums sm:px-3", income ? "text-leaf" : "text-clay")}>{formatCurrency(amount)}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(createdAt)}</td>
      <td className="whitespace-nowrap px-3 py-2"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", status === "pending" ? "bg-amber-100 text-amber-800" : status === "approved" ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay")}>
        {busy ? "รอผล" : statusLabels[status]}
      </span></td>
      <td className="min-w-36 max-w-48 break-words px-3 py-2 text-pretty">{requester}</td>
      <td className="min-w-36 max-w-48 break-words px-3 py-2 text-pretty">{decider}</td>
      <td className="min-w-40 max-w-56 break-words px-3 py-2 text-pretty text-ink/70">{reason || "—"}</td>
    </tr>
  );
}

export function IncomeExpenseApprovalTable({ requests, cashRequests, branchRequests, locationNames, decidingIds, onDecision, onCashDecision, onBranchDecision }: {
  requests: IncomeExpenseApprovalRequest[]; cashRequests: CashTransferDeleteRequest[]; branchRequests: BranchTransferDeleteRequest[];
  locationNames: Map<string, string>; decidingIds: Set<string>;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  onCashDecision: (id: string, decision: "approved" | "rejected") => void;
  onBranchDecision: (id: string, decision: "approved" | "rejected") => void;
}) {
  return <div className="min-w-0">
    <p className="mb-2 text-pretty text-xs text-ink/60">เลื่อนตารางซ้าย–ขวาเพื่อดูข้อมูลทั้งหมด</p>
    <div role="region" aria-label="ตารางคำขออนุมัติ เลื่อนแนวนอนเพื่อดูข้อมูลเพิ่มเติม" tabIndex={0} className="focus-ring max-w-full overflow-x-auto rounded-lg border border-black/10 bg-white">
    <table className="w-[1088px] table-fixed border-collapse text-sm sm:w-[1328px]">
      <caption className="sr-only">รายการคำขออนุมัติรับ-จ่ายและประวัติการพิจารณา</caption>
      <colgroup>
        <col className="w-12 sm:w-28" />
        <col className="w-32 sm:w-64" />
        <col className="w-24 sm:w-32" />
        <col className="w-40" />
        <col className="w-28 sm:w-32" />
        <col className="w-40" />
        <col className="w-40" />
        <col className="w-56" />
      </colgroup>
      <thead className="bg-sand text-left text-xs font-semibold text-ink/70">
        <tr className="border-b border-black/10">
          <th scope="col" className="px-0.5 py-2.5 sm:px-3">จัดการ</th>
          <th scope="col" className="px-1 py-2.5 sm:px-3">รายการ</th>
          <th scope="col" className="px-1 py-2.5 text-right sm:px-3">จำนวนเงิน</th>
          <th scope="col" className="px-3 py-2.5">วันที่</th>
          <th scope="col" className="px-3 py-2.5">สถานะ</th>
          <th scope="col" className="px-3 py-2.5">ผู้ขอ</th>
          <th scope="col" className="px-3 py-2.5">ผู้พิจารณา</th>
          <th scope="col" className="px-3 py-2.5">เหตุผล</th>
        </tr>
      </thead>
      <tbody>
    {branchRequests.map(r => <ApprovalRow key={`branch:${r.id}`} id={r.id} title={r.transferDisplayNo} status={r.requestStatus} operation="delete" amount={r.amount}
      createdAt={r.createdAt} location={r.locationName} requester={formatPerson(r.requestedByName, r.requestedByPhone)} decider={formatPerson(r.decidedByName, r.decidedByPhone)}
      reason="ลบหลังสาขายืนยันรับ" type="ลบรายการโอนเข้าบัญชี" busy={decidingIds.has(r.id)} onApprove={() => onBranchDecision(r.id, "approved")} onReject={() => onBranchDecision(r.id, "rejected")} />)}
    {cashRequests.map(r => <ApprovalRow key={`cash:${r.id}`} id={r.id} title={`${r.transferDisplayNo} → ${r.targetLocationName}`} status={r.requestStatus} operation="delete" amount={r.sentTotal}
      createdAt={r.createdAt} location={r.sourceLocationName} requester={formatPerson(r.requestedByName, r.requestedByPhone)} decider={formatPerson(r.decidedByName, r.decidedByPhone)}
      reason="ลบหลังปลายทางตรวจรับ" type="ลบถาวรรายการโยกเงิน" busy={decidingIds.has(r.id)} onApprove={() => onCashDecision(r.id, "approved")} onReject={() => onCashDecision(r.id, "rejected")}>
      รับจริง {formatCurrency(r.receivedTotal)} · ผลต่าง {formatCurrency(r.differenceTotal)}
    </ApprovalRow>)}
    {requests.map(r => <ApprovalRow key={`income:${r.id}`} id={r.id} title={r.title} status={r.requestStatus} operation={r.requestedOperation} amount={r.cost} income={r.txType === "income"}
      createdAt={r.createdAt} location={locationNames.get(r.locationId) ?? "ไม่ทราบสาขา"} requester={formatPerson(r.requestedByName, r.requestedByPhone)} decider={formatPerson(r.decidedByName, r.decidedByPhone)}
      reason={r.matchedReasons.map(reason => reasonLabels[reason]).join(" · ")} type={r.txType === "income" ? "รายรับ" : "รายจ่าย"} busy={decidingIds.has(r.id)} onApprove={() => onDecision(r.id, "approved")} onReject={() => onDecision(r.id, "rejected")}>
      {r.matchedKeyword && <p>พบ: {r.matchedKeyword}</p>}
      {r.saleLines && r.saleLines.length > 0 && <ol className="list-decimal space-y-1 pl-5">{r.saleLines.map(line => <li key={`${r.id}:${line.sequenceNo}`}>
        {line.title} · {line.quantity} × {formatCurrency(line.unitPrice)} = {formatCurrency(line.lineTotal)}
      </li>)}</ol>}
    </ApprovalRow>)}
      </tbody>
    </table>
    </div>
  </div>;
}
