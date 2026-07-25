"use client";

import { useMemo, useState } from "react";
import { Banknote, Save, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import {
  CASH_DENOMINATIONS,
  buildCashTransferCreatePayload,
  buildCashTransferUpdatePayload,
  calculateCashDifferences,
  calculateCashTotal,
  cashTransferStatusLabel,
  cashCountValues,
  emptyCashCountValues,
  parseCashCounts,
  type CashCountValues,
} from "@/lib/cash-branch-transfer";
import { useLocations } from "@/hooks/useLocations";
import type { CashBranchTransfer, CashDenominationCounts, Location } from "@/types";

function CountFields({ values, onChange, sent }: { values: CashCountValues; onChange: (key: keyof CashDenominationCounts, value: string) => void; sent?: CashDenominationCounts }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {CASH_DENOMINATIONS.map(([key, label, value]) => (
        <label key={key} className="group flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(23,32,27,0.03)] transition hover:border-river/35 hover:shadow-[0_8px_18px_rgba(49,107,131,0.08)] focus-within:border-river focus-within:ring-2 focus-within:ring-river/15">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{label}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/50">
              <span className="rounded-md bg-field px-1.5 py-0.5 font-medium text-ink/65">{formatCurrency(value)}</span>
              {sent && <span className="font-medium text-river">ส่ง {sent[key]} ใบ</span>}
            </span>
          </span>
          <span className="flex items-center rounded-lg border border-black/10 bg-field/45 pl-1.5 focus-within:border-river/35 focus-within:bg-white">
            <input aria-label={label} inputMode="numeric" value={values[key]} onChange={(event) => onChange(key, event.target.value.replace(/\D/g, ""))} className="h-9 w-14 bg-transparent px-1 text-right text-base font-bold text-ink outline-none sm:w-16" />
            <span className="pr-2 text-xs font-medium text-ink/45">ใบ</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function CashBranchTransferCreateModal({ location, transfer, online, onSave, onClose }: { location: Location; transfer?: CashBranchTransfer; online: boolean; onSave: (payload: unknown) => Promise<unknown>; onClose: () => void }) {
  const { locations } = useLocations(); const [targetLocationId, setTargetLocationId] = useState(transfer?.targetLocationId ?? ""); const [counts, setCounts] = useState(transfer ? cashCountValues(transfer.sent) : emptyCashCountValues); const [note, setNote] = useState(transfer?.note ?? ""); const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseCashCounts(counts), [counts]); const amount = calculateCashTotal(parsed);
  const submit = async () => { if (!online) return toast.error("การโยกเงินสดต้องออนไลน์ก่อน"); if (!targetLocationId || !parsed || amount <= 0) return toast.error("กรุณาเลือกสาขาและกรอกจำนวนเงินสดครบทุกช่อง"); setSaving(true); try { const payload = transfer ? buildCashTransferUpdatePayload({ targetLocationId, sent: parsed, note }) : buildCashTransferCreatePayload({ sourceLocationId: location.id, targetLocationId, sent: parsed, note, clientTempId: crypto.randomUUID(), idempotencyKey: `cash:${crypto.randomUUID()}` }); await onSave(payload); toast.success(transfer ? "แก้ไขรายการเงินสดแล้ว" : "บันทึกรายการเงินสด รอปลายทางรับเงิน"); onClose(); } catch (error) { toast.error(error instanceof Error ? error.message : "บันทึกรายการไม่สำเร็จ"); } finally { setSaving(false); } };
  return <Modal title={transfer ? "แก้ไขการโยกเงินสด" : "โยกเงินไปสาขาอื่น (เงินสด)"} onClose={onClose}>
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="cash-target-location" className="text-sm font-bold text-ink">สาขาปลายทาง</label>
        <span className="rounded-full bg-river/10 px-2.5 py-1 text-xs font-semibold text-river">เงินสด</span>
      </div>
      <select id="cash-target-location" aria-label="สาขาปลายทาง" value={targetLocationId} onChange={(e) => setTargetLocationId(e.target.value)} className="focus-ring h-12 w-full rounded-xl border border-black/10 bg-white px-3.5 font-medium text-ink shadow-[0_1px_2px_rgba(23,32,27,0.03)] transition hover:border-river/35 focus:border-river">
        <option value="">-- เลือกสาขาปลายทาง --</option>
        {locations.filter((item) => item.id !== location.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <p className="text-xs text-ink/50">ระบุสาขาที่จะรับเงินสดรายการนี้</p>
    </section>

    <section className="rounded-2xl border border-black/[0.07] bg-field/40 p-3.5 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-ink">จำนวนที่ส่ง</h4>
          <p className="mt-0.5 text-xs text-ink/50">กรอกจำนวนฉบับของแต่ละชนิดราคา</p>
        </div>
        <span className="text-xs font-medium text-ink/45">หน่วย: ใบ</span>
      </div>
      <CountFields values={counts} onChange={(key, value) => setCounts((current) => ({ ...current, [key]: value }))} />
    </section>

    <Summary label="ยอดส่งรวม" amount={amount} prominent />

    <section className="space-y-2">
      <label htmlFor="cash-transfer-note" className="text-sm font-bold text-ink">หมายเหตุ <span className="font-normal text-ink/45">(ไม่บังคับ)</span></label>
      <textarea id="cash-transfer-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" className="focus-ring min-h-24 w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-sm shadow-[0_1px_2px_rgba(23,32,27,0.03)] transition placeholder:text-ink/35 hover:border-river/35 focus:border-river" />
    </section>

    <footer className="flex flex-col-reverse gap-2 border-t border-black/[0.07] pt-4 sm:flex-row sm:items-center sm:justify-end">
      <button type="button" onClick={onClose} className="focus-ring rounded-xl px-4 py-2.5 font-semibold text-ink/65 transition hover:bg-field hover:text-ink">ยกเลิก</button>
      <button disabled={saving || !online} onClick={() => void submit()} className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-river px-5 py-2.5 font-bold text-white shadow-[0_8px_18px_rgba(49,107,131,0.22)] transition hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-40"><Save size={17} />{saving ? "กำลังบันทึก..." : "บันทึกรายการ"}</button>
    </footer>
  </Modal>;
}

export function CashBranchTransferReceiveModal({ transfer, online, onReceive, onClose }: { transfer: CashBranchTransfer; online: boolean; onReceive: (counts: CashDenominationCounts) => Promise<unknown>; onClose: () => void }) {
  const [counts, setCounts] = useState(emptyCashCountValues); const [saving, setSaving] = useState(false); const parsed = useMemo(() => parseCashCounts(counts), [counts]); const received = calculateCashTotal(parsed); const difference = parsed ? calculateCashDifferences(transfer.sent, parsed).total : null;
  const submit = async () => { if (!online) return toast.error("การตรวจรับเงินต้องออนไลน์ก่อน"); if (!parsed) return toast.error("กรุณากรอกจำนวนที่รับจริงครบทุกช่อง รวมถึง 0"); setSaving(true); try { await onReceive(parsed); toast.success(difference === 0 ? "ยืนยันรับเงินแล้ว" : "บันทึกยอดไม่ตรงแล้ว"); onClose(); } catch (error) { toast.error(error instanceof Error ? error.message : "ตรวจรับไม่สำเร็จ"); } finally { setSaving(false); } };
  return <Modal title="ตรวจรับเงินสด" onClose={onClose}><p className="text-sm text-ink/60">ผู้ส่ง: {transfer.createdByName} · ยอดส่ง {formatCurrency(transfer.sentTotal)}</p><CountFields values={counts} sent={transfer.sent} onChange={(key, value) => setCounts((current) => ({ ...current, [key]: value }))} /><DenominationComparison sent={transfer.sent} received={parsed} /><Summary label="ยอดรับจริง" amount={received} /><p className={difference === null || difference === 0 ? "text-leaf" : "font-bold text-clay"}>ผลต่างรวม: {difference === null ? "กรอกข้อมูลให้ครบ" : formatCurrency(difference)}</p><footer><button onClick={onClose}>ยกเลิก</button><button disabled={saving || !online} onClick={() => void submit()} className="bg-river text-white"><Save size={16} /> ยืนยันรับเงิน</button></footer></Modal>;
}

export function CashBranchTransferDetails({ transfer, superAdmin, canEdit, online, onEdit, onAccept, onDelete, onClose }: { transfer: CashBranchTransfer; superAdmin: boolean; canEdit: boolean; online: boolean; onEdit: () => void; onAccept: (reason: string) => Promise<unknown>; onDelete: () => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const status = cashTransferStatusLabel(transfer.status, transfer.differenceTotal);
  const reportLockReason = transfer.reportLockNo ? `ล็อกโดยรายงาน ${transfer.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : null;
  return <Modal title="รายละเอียดเงินสด" onClose={onClose}><p className="font-bold">{status}</p>{reportLockReason && <p className="rounded bg-amber/15 p-2 text-sm font-semibold text-ink">{reportLockReason}</p>}<Summary label="ยอดส่ง" amount={transfer.sentTotal} /><Summary label="ยอดรับจริง" amount={transfer.receivedTotal ?? 0} /><DenominationComparison sent={transfer.sent} received={transfer.received} /><p className="text-sm">ผู้ส่ง: {transfer.createdByName} · ผู้ตรวจรับ: {transfer.receivedByName ?? "ยังไม่ตรวจรับ"}</p>{transfer.note && <p className="text-sm">หมายเหตุ: {transfer.note}</p>}{canEdit && transfer.status === "pending_receipt" && <button disabled={!online || Boolean(reportLockReason)} title={reportLockReason ?? undefined} onClick={onEdit} className="bg-river px-3 py-2 font-semibold text-white disabled:opacity-40">แก้ไขก่อนตรวจรับ</button>}{superAdmin && transfer.status === "mismatched" && <><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลยอมรับผลต่าง" className="min-h-20 w-full rounded border border-black/15 p-2" /><button disabled={saving || !online} onClick={() => { if (!online) return toast.error("การยอมรับผลต่างต้องออนไลน์ก่อน"); if (!reason.trim()) return toast.error("กรุณาระบุเหตุผล"); setSaving(true); void onAccept(reason).then(onClose).catch((error) => toast.error(error.message)).finally(() => setSaving(false)); }} className="bg-amber px-3 py-2 font-semibold">ยอมรับผลต่าง</button></>}{superAdmin && <button disabled={saving || !online || Boolean(reportLockReason)} title={reportLockReason ?? undefined} onClick={() => { if (!online) return toast.error("การลบรายการต้องออนไลน์ก่อน"); if (reportLockReason) return toast.error(reportLockReason); if (!window.confirm("ลบถาวรรายการเงินสดนี้ใช่ไหม?")) return; setSaving(true); void onDelete().then(onClose).catch((error) => toast.error(error.message)).finally(() => setSaving(false)); }} className="bg-clay px-3 py-2 font-semibold text-white disabled:opacity-40">ลบถาวร</button>}<footer><button onClick={onClose}>ปิด</button></footer></Modal>;
}

function DenominationComparison({ sent, received }: { sent: CashDenominationCounts; received: CashDenominationCounts | null }) { return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink/55"><th>ชนิด</th><th>ส่ง</th><th>รับจริง</th><th>ผลต่าง</th></tr></thead><tbody>{CASH_DENOMINATIONS.map(([key, label]) => <tr key={key} className="border-t border-black/10"><td className="py-1">{label}</td><td>{sent[key]}</td><td>{received?.[key] ?? "-"}</td><td>{received ? received[key] - sent[key] : "-"}</td></tr>)}</tbody></table></div>; }

function Summary({ label, amount, prominent = false }: { label: string; amount: number; prominent?: boolean }) { return <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${prominent ? "border border-river/15 bg-river text-white shadow-[0_8px_20px_rgba(49,107,131,0.16)]" : "bg-river/5"}`}><span className="font-semibold">{label}</span><strong className="text-lg tabular-nums">{formatCurrency(amount)}</strong></div>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 backdrop-blur-[2px] sm:p-6"><div className="my-3 w-full max-w-2xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_24px_70px_rgba(23,32,27,0.28)] sm:my-6"><header className="flex items-start justify-between gap-4 border-b border-river/10 bg-gradient-to-r from-river/10 via-white to-leaf/10 px-5 py-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-river text-white shadow-[0_6px_14px_rgba(49,107,131,0.25)]"><Banknote size={21} /></span><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-river">Cash transfer</p><h3 className="mt-0.5 text-lg font-bold leading-tight text-ink sm:text-xl">{title}</h3></div></div><button type="button" aria-label="ปิด" onClick={onClose} className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80 text-ink/65 shadow-sm transition hover:bg-white hover:text-ink"><X size={20} /></button></header><div className="space-y-5 p-5 sm:p-6">{children}</div></div></div>; }
