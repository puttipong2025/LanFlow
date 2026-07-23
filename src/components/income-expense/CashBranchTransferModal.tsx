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
  return <div className="grid gap-2 sm:grid-cols-2">{CASH_DENOMINATIONS.map(([key, label, value]) => <label key={key} className="flex items-center justify-between gap-2 rounded border border-black/10 bg-field/30 px-3 py-2 text-sm"><span>{label} <span className="text-ink/45">× {value}</span>{sent && <span className="ml-1 text-river">ส่ง {sent[key]}</span>}</span><input aria-label={label} inputMode="numeric" value={values[key]} onChange={(event) => onChange(key, event.target.value.replace(/\D/g, ""))} className="w-20 rounded border border-black/15 bg-white px-2 py-1 text-right" /></label>)}</div>;
}

export function CashBranchTransferCreateModal({ location, transfer, online, onSave, onClose }: { location: Location; transfer?: CashBranchTransfer; online: boolean; onSave: (payload: unknown) => Promise<unknown>; onClose: () => void }) {
  const { locations } = useLocations(); const [targetLocationId, setTargetLocationId] = useState(transfer?.targetLocationId ?? ""); const [counts, setCounts] = useState(transfer ? cashCountValues(transfer.sent) : emptyCashCountValues); const [note, setNote] = useState(transfer?.note ?? ""); const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseCashCounts(counts), [counts]); const amount = calculateCashTotal(parsed);
  const submit = async () => { if (!online) return toast.error("การโยกเงินสดต้องออนไลน์ก่อน"); if (!targetLocationId || !parsed || amount <= 0) return toast.error("กรุณาเลือกสาขาและกรอกจำนวนเงินสดครบทุกช่อง"); setSaving(true); try { const payload = transfer ? buildCashTransferUpdatePayload({ targetLocationId, sent: parsed, note }) : buildCashTransferCreatePayload({ sourceLocationId: location.id, targetLocationId, sent: parsed, note, clientTempId: crypto.randomUUID(), idempotencyKey: `cash:${crypto.randomUUID()}` }); await onSave(payload); toast.success(transfer ? "แก้ไขรายการเงินสดแล้ว" : "บันทึกรายการเงินสด รอปลายทางรับเงิน"); onClose(); } catch (error) { toast.error(error instanceof Error ? error.message : "บันทึกรายการไม่สำเร็จ"); } finally { setSaving(false); } };
  return <Modal title={transfer ? "แก้ไขการโยกเงินสด" : "โยกเงินไปสาขาอื่น (เงินสด)"} onClose={onClose}><select aria-label="สาขาปลายทาง" value={targetLocationId} onChange={(e) => setTargetLocationId(e.target.value)} className="w-full rounded border border-black/15 px-3 py-2"><option value="">-- เลือกสาขาปลายทาง --</option>{locations.filter((item) => item.id !== location.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><h4 className="font-bold">จำนวนที่ส่ง</h4><CountFields values={counts} onChange={(key, value) => setCounts((current) => ({ ...current, [key]: value }))} /><Summary label="ยอดส่งรวม" amount={amount} /><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" className="min-h-20 w-full rounded border border-black/15 p-2" /><footer><button onClick={onClose}>ยกเลิก</button><button disabled={saving || !online} onClick={() => void submit()} className="bg-river text-white"><Save size={16} /> บันทึก</button></footer></Modal>;
}

export function CashBranchTransferReceiveModal({ transfer, online, onReceive, onClose }: { transfer: CashBranchTransfer; online: boolean; onReceive: (counts: CashDenominationCounts) => Promise<unknown>; onClose: () => void }) {
  const [counts, setCounts] = useState(emptyCashCountValues); const [saving, setSaving] = useState(false); const parsed = useMemo(() => parseCashCounts(counts), [counts]); const received = calculateCashTotal(parsed); const difference = parsed ? calculateCashDifferences(transfer.sent, parsed).total : null;
  const submit = async () => { if (!online) return toast.error("การตรวจรับเงินต้องออนไลน์ก่อน"); if (!parsed) return toast.error("กรุณากรอกจำนวนที่รับจริงครบทุกช่อง รวมถึง 0"); setSaving(true); try { await onReceive(parsed); toast.success(difference === 0 ? "ยืนยันรับเงินแล้ว" : "บันทึกยอดไม่ตรงแล้ว"); onClose(); } catch (error) { toast.error(error instanceof Error ? error.message : "ตรวจรับไม่สำเร็จ"); } finally { setSaving(false); } };
  return <Modal title="ตรวจรับเงินสด" onClose={onClose}><p className="text-sm text-ink/60">ผู้ส่ง: {transfer.createdByName} · ยอดส่ง {formatCurrency(transfer.sentTotal)}</p><CountFields values={counts} sent={transfer.sent} onChange={(key, value) => setCounts((current) => ({ ...current, [key]: value }))} /><DenominationComparison sent={transfer.sent} received={parsed} /><Summary label="ยอดรับจริง" amount={received} /><p className={difference === null || difference === 0 ? "text-leaf" : "font-bold text-clay"}>ผลต่างรวม: {difference === null ? "กรอกข้อมูลให้ครบ" : formatCurrency(difference)}</p><footer><button onClick={onClose}>ยกเลิก</button><button disabled={saving || !online} onClick={() => void submit()} className="bg-river text-white"><Save size={16} /> ยืนยันรับเงิน</button></footer></Modal>;
}

export function CashBranchTransferDetails({ transfer, superAdmin, canEdit, online, onEdit, onAccept, onDelete, onClose }: { transfer: CashBranchTransfer; superAdmin: boolean; canEdit: boolean; online: boolean; onEdit: () => void; onAccept: (reason: string) => Promise<unknown>; onDelete: () => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const status = cashTransferStatusLabel(transfer.status, transfer.differenceTotal);
  return <Modal title="รายละเอียดเงินสด" onClose={onClose}><p className="font-bold">{status}</p><Summary label="ยอดส่ง" amount={transfer.sentTotal} /><Summary label="ยอดรับจริง" amount={transfer.receivedTotal ?? 0} /><DenominationComparison sent={transfer.sent} received={transfer.received} /><p className="text-sm">ผู้ส่ง: {transfer.createdByName} · ผู้ตรวจรับ: {transfer.receivedByName ?? "ยังไม่ตรวจรับ"}</p>{transfer.note && <p className="text-sm">หมายเหตุ: {transfer.note}</p>}{canEdit && transfer.status === "pending_receipt" && <button disabled={!online} onClick={onEdit} className="bg-river px-3 py-2 font-semibold text-white">แก้ไขก่อนตรวจรับ</button>}{superAdmin && transfer.status === "mismatched" && <><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลยอมรับผลต่าง" className="min-h-20 w-full rounded border border-black/15 p-2" /><button disabled={saving || !online} onClick={() => { if (!online) return toast.error("การยอมรับผลต่างต้องออนไลน์ก่อน"); if (!reason.trim()) return toast.error("กรุณาระบุเหตุผล"); setSaving(true); void onAccept(reason).then(onClose).catch((error) => toast.error(error.message)).finally(() => setSaving(false)); }} className="bg-amber px-3 py-2 font-semibold">ยอมรับผลต่าง</button></>}{superAdmin && <button disabled={saving || !online} onClick={() => { if (!online) return toast.error("การลบรายการต้องออนไลน์ก่อน"); if (!window.confirm("ลบถาวรรายการเงินสดนี้ใช่ไหม?")) return; setSaving(true); void onDelete().then(onClose).catch((error) => toast.error(error.message)).finally(() => setSaving(false)); }} className="bg-clay px-3 py-2 font-semibold text-white">ลบถาวร</button>}<footer><button onClick={onClose}>ปิด</button></footer></Modal>;
}

function DenominationComparison({ sent, received }: { sent: CashDenominationCounts; received: CashDenominationCounts | null }) { return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-ink/55"><th>ชนิด</th><th>ส่ง</th><th>รับจริง</th><th>ผลต่าง</th></tr></thead><tbody>{CASH_DENOMINATIONS.map(([key, label]) => <tr key={key} className="border-t border-black/10"><td className="py-1">{label}</td><td>{sent[key]}</td><td>{received?.[key] ?? "-"}</td><td>{received ? received[key] - sent[key] : "-"}</td></tr>)}</tbody></table></div>; }

function Summary({ label, amount }: { label: string; amount: number }) { return <div className="flex justify-between rounded bg-river/5 px-3 py-2"><span>{label}</span><strong>{formatCurrency(amount)}</strong></div>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6"><div className="mt-4 w-full max-w-2xl space-y-4 rounded-lg bg-white p-5 shadow-2xl"><header className="flex items-center justify-between"><h3 className="flex gap-2 text-lg font-bold"><Banknote className="text-river" />{title}</h3><button aria-label="ปิด" onClick={onClose}><X /></button></header>{children}</div></div>; }
