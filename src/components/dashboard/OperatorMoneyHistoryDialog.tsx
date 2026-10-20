"use client";

import { useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { OperatorHistoryFilters } from "./OperatorHistoryFilters";
import { ApprovalOperationBadge } from "@/components/income-expense/ApprovalOperationBadge";
import { useOperatorMoneyHistory, type OperatorHistoryFilters as Filters } from "@/hooks/useOperatorMoneyHistory";
import { MONEY_HISTORY_ACTIONS, MONEY_HISTORY_ROUTES, type MoneyHistoryRoute } from "@/lib/operator-money-history";
import { formatCurrency } from "@/lib/format";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";

const INITIAL: Filters = { actor: "", locationId: "", route: "", date: "", action: "all", cursor: "" };
const timestampFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok",
});
const timestamp = (value: string) => timestampFormatter.format(new Date(value));
const buttonClass = "focus-ring min-h-10 rounded-md border border-actionSecondary/25 px-3 py-2 text-sm font-semibold text-actionSecondary hover:bg-field disabled:opacity-40";

export default function OperatorMoneyHistoryDialog({ ownerScope, online, onClose, returnFocusElement }: {
  ownerScope: string;
  online: boolean;
  onClose: () => void;
  returnFocusElement: HTMLElement | null;
}) {
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [page, setPage] = useState(1);
  const history = useOperatorMoneyHistory(ownerScope, online, filters);
  // Hide all cached content whenever revalidating or on error (including revoked access).
  const data = online && !history.isError && !history.isFetching ? history.data : undefined;
  const actorNameCounts = new Map<string, number>();
  for (const actor of data?.actors ?? []) actorNameCounts.set(actor.name, (actorNameCounts.get(actor.name) ?? 0) + 1);
  const change = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, date: current.date || data?.selectedDate || "", ...patch, cursor: "" }));
    setPage(1);
  };

  return (
    <ModalShell title="ตรวจประวัติผู้สร้างรายการ" subtitle="ประวัติเหตุการณ์เงินเฉพาะสาขาที่คุณมีสิทธิ์เข้าถึง"
      size="wide" nativeModal renderInPortal closeOnEscape returnFocusElement={returnFocusElement} onClose={onClose}>
      <div className="space-y-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {!online ? <p role="status" className="text-pretty text-sm text-ink/70">เชื่อมต่ออินเทอร์เน็ตเพื่อดูประวัติ แล้วเปิดหน้าต่างใหม่</p> : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 text-sm font-semibold text-ink/70">
                บัญชีผู้สร้างรายการ
                <select value={filters.actor} disabled={!data}
                  onChange={(event) => { setFilters({ ...INITIAL, actor: event.target.value }); setPage(1); }}
                  className="focus-ring mt-1 block min-h-10 w-full rounded-md border border-black/15 bg-white px-3 text-ink disabled:opacity-50">
                  <option value="">เลือกผู้สร้างรายการ</option>
                  {data?.actors.map((actor) => <option key={actor.key} value={actor.key}>
                    {actor.name}{(actorNameCounts.get(actor.name) ?? 0) > 1 ? ` · ${actor.key}` : ""}
                  </option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-ink/70">
                วันที่เกิดเหตุการณ์
                <input type="date" value={filters.date || data?.selectedDate || ""}
                  disabled={!filters.actor || !data} min={data?.availableFrom} max={data?.availableTo}
                  onChange={(event) => change({ date: event.target.value })}
                  className="focus-ring mt-1 block min-h-10 rounded-md border border-black/15 bg-white px-3 tabular-nums text-ink disabled:opacity-50" />
              </label>
            </div>
            {history.isFetching && <div role="status" className="space-y-2 py-4">
              <p className="text-pretty text-sm text-ink/60">กำลังโหลดประวัติ...</p>
              <div className="h-10 rounded-md bg-field" /><div className="h-24 rounded-md bg-field" />
            </div>}
            {history.isError && <div role="alert" className="space-y-2">
              <p className="text-pretty text-sm text-danger">{history.error.message}</p>
              <button className={buttonClass} type="button" onClick={() => void history.refetch()}>ลองใหม่</button>
              <button className={buttonClass} type="button" onClick={() => { setFilters(INITIAL); setPage(1); }}>เลือกผู้สร้างรายการใหม่</button>
            </div>}
            {data && !filters.actor && <div className="space-y-2">
              <p role="status" className="text-pretty text-sm text-ink/60">
                {data.actors.length ? "เลือกผู้สร้างรายการด้านบนเพื่อดูสาขาและหน้าต้นทางของเหตุการณ์" : "ไม่มีเหตุการณ์ในช่วงเก็บประวัติ"}
              </p>
              {!data.actors.length && <button className={buttonClass} type="button" onClick={() => void history.refetch()}>ตรวจใหม่</button>}
            </div>}
            {data && filters.actor && <>
              <OperatorHistoryFilters label="สาขา" selected={filters.locationId} onSelect={(locationId) => change({ locationId })}
                options={[{ key: "", name: "ทุกสาขา", count: data.locations.reduce((sum, item) => sum + item.count, 0) }, ...data.locations]} />
              <OperatorHistoryFilters label="หน้าต้นทาง" selected={filters.route} onSelect={(route) => change({ route })}
                options={[{ key: "", name: "ทุกหน้าต้นทาง", count: data.routes.reduce((sum, item) => sum + item.count, 0) },
                  ...data.routes.map((item) => ({ ...item, name: MONEY_HISTORY_ROUTES[item.key as MoneyHistoryRoute] }))]} />
              <OperatorHistoryFilters label="ประเภทเหตุการณ์" allKey="all" selected={filters.action} onSelect={(action) => change({ action })}
                options={MONEY_HISTORY_ACTIONS.map((item) => ({ ...item, count: data.counts[item.key] }))} />
              <p className="text-pretty text-xs tabular-nums text-ink/60">หน้า {page} · 10 เหตุการณ์ต่อหน้า · เก็บย้อนหลัง {data.retentionDays} วัน · จำนวนคือเหตุการณ์ รวมฝั่งรับและจ่ายของเงินโยกตามสาขา</p>
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
                  <caption className="sr-only">ประวัติรายการเงินของผู้สร้างรายการ แยกสาขาและหน้าต้นทาง</caption>
                  <thead><tr className="border-b border-black/10 text-ink/60">
                    {["วันเวลา", "สาขา", "หน้าต้นทาง", "Action", "เลขรายการ", "รายละเอียด", "จำนวนเงิน", "ผู้สร้างรายการ"].map((label) =>
                      <th key={label} scope="col" className="px-3 py-2 first:pl-0">{label}</th>)}
                  </tr></thead>
                  <tbody>{data.rows.map((row) => <tr key={row.id} className="border-b border-black/5">
                    <td className="py-3 pr-3">{timestamp(row.occurredAt)}</td>
                    <td className="px-3">{row.locationName}</td>
                    <td className="px-3">{MONEY_HISTORY_ROUTES[row.route]}</td>
                    <td className="px-3"><ApprovalOperationBadge operation={row.action} /></td>
                    <td className="px-3 font-semibold">{row.number}</td>
                    <td className="max-w-sm whitespace-normal px-3">{row.title}</td>
                    <td className="px-3 text-right font-semibold">{row.direction === "income" ? "+" : "−"}{row.sourceType === "payroll_slip" ? formatPayrollCurrency(row.amount) : formatCurrency(row.amount)}</td>
                    <td className="px-3">{row.actorName || "ไม่ทราบผู้สร้างรายการ"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              {!data.rows.length && <div role="status" className="space-y-2 py-4 text-center">
                <p className="text-pretty text-sm text-ink/60">ไม่มีเหตุการณ์ตรงกับตัวกรองในวันที่เลือก</p>
                <button type="button" className={buttonClass} onClick={() => { setFilters({ ...INITIAL, actor: filters.actor }); setPage(1); }}>ดูวันที่ล่าสุดและล้างตัวกรอง</button>
              </div>}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="focus-ring rounded-lg border border-actionSecondary/25 bg-white px-3 py-2 text-sm font-semibold text-actionSecondary hover:bg-field disabled:cursor-not-allowed disabled:opacity-40" disabled={page === 1 && !filters.date} onClick={() => { change({ date: "" }); }}>วันที่ล่าสุด · {data.latestAt ? timestamp(data.latestAt) : "—"}</button>
                <button type="button" className="focus-ring rounded-lg bg-actionSecondary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40" disabled={!data.nextCursor} onClick={() => {
                  setFilters((current) => ({ ...current, date: data.selectedDate, cursor: data.nextCursor || "" }));
                  setPage((current) => current + 1);
                }}>วันที่ย้อนหลัง · ก่อน {data.rows.length > 0 ? timestamp(data.rows[data.rows.length - 1].occurredAt) : "—"}</button>
              </div>
            </>}
          </>
        )}
      </div>
    </ModalShell>
  );
}
