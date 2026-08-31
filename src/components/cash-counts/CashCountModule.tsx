"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Banknote, Eye, Loader2, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Location, Profile } from "@/types";
import { CASH_DENOMINATIONS, type CashCountDetail, type CashCountReceipt, type CashCountSession, type CashCountSummary, type CashDenomination } from "@/types/cash-counts";
import type { DocumentDeletionAudit } from "@/types/deletion-audits";
import { InlineNumber } from "@/components/shared/InlineNumber";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { DeletionAuditTable } from "@/components/shared/DeletionAuditTable";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures } from "@/lib/permissions";
import { getPendingEvents } from "@/lib/idb-queue";
import { cn } from "@/lib/cn";

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

function statusLabel(status: string | null) {
  if (status === "insufficient_data") return "ข้อมูลไม่พอ";
  if (status === "normal") return "ปกติ";
  if (status === "review") return "ควรตรวจสอบ";
  if (status === "high_anomaly") return "พิรุธสูง";
  return "รอบตั้งต้น";
}

function ConfirmDialog({ open, title, description, detail, confirmLabel, busy, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean;
  detail?: ReactNode;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="กลับไปตรวจ"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {detail}
    </AlertDialog>
  );
}

export function CashCountModule({ selectedLocation, profile, online, initialCountId, onInitialCountHandled }: {
  selectedLocation: Location; profile: Profile; online: boolean; initialCountId?: string | null; onInitialCountHandled?: () => void;
}) {
  const [session, setSession] = useState<CashCountSession | null>(null);
  const [receipt, setReceipt] = useState<CashCountReceipt | null>(null);
  const [values, setValues] = useState<Record<CashDenomination, number | "">>(() => Object.fromEntries(CASH_DENOMINATIONS.map((d) => [d, ""])) as Record<CashDenomination, number | "">);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<"submit" | "cancel" | "delete" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashCountSummary | null>(null);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<CashCountSummary[]>([]);
  const [deletions, setDeletions] = useState<DocumentDeletionAudit[]>([]);
  const [historyView, setHistoryView] = useState<"current" | "deletions">("current");
  const [deletionsLoading, setDeletionsLoading] = useState(false);
  const [deletionsHasMore, setDeletionsHasMore] = useState(false);
  const [deletionsCursor, setDeletionsCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashCountDetail | null>(null);
  const handledInitialCountIdRef = useRef<string | null>(null);
  const manager = canManageSystemFeatures(profile);

  const resetForm = useCallback(() => setValues(Object.fromEntries(CASH_DENOMINATIONS.map((d) => [d, ""])) as Record<CashDenomination, number | "">), []);
  const loadSession = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/session?locationId=${encodeURIComponent(selectedLocation.id)}`, { cache: "no-store" });
      await assertApiResponse(response);
      const body = await response.json() as { session: CashCountSession | null };
      setSession(body.session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดสถานะตรวจนับไม่สำเร็จ");
    } finally { setLoading(false); }
  }, [online, selectedLocation.id]);

  const loadHistory = useCallback(async () => {
    if (!online || !manager) return;
    const response = await authFetch(`/api/lanflow/cash-counts?locationId=${encodeURIComponent(selectedLocation.id)}`, { cache: "no-store" });
    await assertApiResponse(response);
    setHistory(((await response.json()) as { counts: CashCountSummary[] }).counts);
  }, [manager, online, selectedLocation.id]);

  const loadDetail = useCallback(async (id: string) => {
    const response = await authFetch(`/api/lanflow/cash-counts/${id}?locationId=${encodeURIComponent(selectedLocation.id)}`, { cache: "no-store" });
    await assertApiResponse(response);
    setDetail(await response.json() as CashCountDetail);
  }, [selectedLocation.id]);

  const loadDeletions = useCallback(async (cursor: string | null = null, append = false) => {
    if (!online || !manager) return;
    setDeletionsLoading(true);
    try {
      const params = new URLSearchParams({ locationId: selectedLocation.id, view: "deletions" });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/cash-counts?${params.toString()}`,
        { cache: "no-store" },
      );
      await assertApiResponse(response);
      const body = (await response.json()) as {
        deletions: DocumentDeletionAudit[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      setDeletions((current) => append
        ? [...current, ...body.deletions.filter((row) => !current.some((item) => item.id === row.id))]
        : body.deletions);
      setDeletionsHasMore(body.hasMore);
      setDeletionsCursor(body.nextCursor);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดประวัติการลบไม่สำเร็จ");
    } finally {
      setDeletionsLoading(false);
    }
  }, [manager, online, selectedLocation.id]);

  useEffect(() => { setReceipt(null); setDetail(null); setDeletions([]); resetForm(); void loadSession(); }, [loadSession, resetForm, selectedLocation.id]);
  useEffect(() => {
    if (!manager) return;
    if (historyView === "deletions") {
      void loadDeletions();
      return;
    }
    void loadHistory().catch((error) => toast.error(
      error instanceof Error ? error.message : "โหลดประวัติไม่สำเร็จ",
    ));
  }, [historyView, loadDeletions, loadHistory, manager, selectedLocation.id]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!initialCountId) {
      handledInitialCountIdRef.current = null;
      return;
    }
    if (!manager || handledInitialCountIdRef.current === initialCountId) return;
    handledInitialCountIdRef.current = initialCountId;
    void loadDetail(initialCountId).catch((error) => toast.error(error instanceof Error ? error.message : "เปิดผลตรวจนับไม่สำเร็จ")).finally(onInitialCountHandled);
  }, [initialCountId, loadDetail, manager, onInitialCountHandled]);

  const secondsLeft = session ? Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000)) : 0;
  const complete = CASH_DENOMINATIONS.every((d) => values[d] !== "");
  const actualTotal = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + (values[d] === "" ? 0 : values[d] * d), 0), [values]);

  async function start() {
    if (!online || working) return;
    setWorking(true);
    setSubmitError(null);
    try {
      const [rubberQueue, incomeQueue] = await Promise.all([
        getPendingEvents({ entity: "rubber_bills", ownerUserId: profile.id, locationId: selectedLocation.id }),
        getPendingEvents({ entity: "income_expense", ownerUserId: profile.id, locationId: selectedLocation.id }),
      ]);
      if (rubberQueue.length + incomeQueue.length > 0) throw new Error("อุปกรณ์นี้ยังมีรายการเงินสดรอซิงก์หรือต้องแก้ไข กรุณาจัดการก่อนเริ่มนับ");
      const response = await authFetch("/api/lanflow/cash-counts/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: selectedLocation.id }) });
      await assertApiResponse(response);
      setSession(((await response.json()) as { session: CashCountSession }).session);
      setReceipt(null); resetForm();
    } catch (error) { toast.error(error instanceof Error ? error.message : "เริ่มตรวจนับไม่สำเร็จ"); }
    finally { setWorking(false); }
  }

  async function submit() {
    if (!session || !complete || secondsLeft <= 0) return;
    setWorking(true);
    setSubmitError(null);
    try {
      const actualCounts = Object.fromEntries(CASH_DENOMINATIONS.map((d) => [String(d), Number(values[d])]));
      const response = await authFetch("/api/lanflow/cash-counts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, actualCounts }) });
      await assertApiResponse(response);
      setReceipt(await response.json() as CashCountReceipt); setSession(null); setConfirmMode(null);
      await loadHistory();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "ส่งผลตรวจนับไม่สำเร็จ");
      setConfirmMode(null);
    }
    finally { setWorking(false); }
  }

  async function cancel() {
    if (!session) return;
    setWorking(true);
    try {
      const response = await authFetch("/api/lanflow/cash-counts/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) });
      await assertApiResponse(response); setSession(null); setConfirmMode(null); resetForm(); toast.success("ยกเลิกช่วงตรวจนับแล้ว");
    } catch (error) { toast.error(error instanceof Error ? error.message : "ยกเลิกไม่สำเร็จ"); }
    finally { setWorking(false); }
  }

  async function removeCount() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/${deleteTarget.id}?locationId=${encodeURIComponent(selectedLocation.id)}`, { method: "DELETE" });
      await assertApiResponse(response); toast.success(`ลบชุด ${deleteTarget.reportNo} แบบถาวรแล้ว`); setDetail(null); setDeleteTarget(null); setConfirmMode(null); await Promise.all([loadHistory(), loadDeletions()]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "ลบชุดตรวจนับไม่สำเร็จ"); }
    finally { setWorking(false); }
  }

  return (
    <section className="space-y-4 tabular-nums">
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col items-start gap-3">
          <div><h2 className="text-balance text-xl font-bold text-ink">นับเงิน — {selectedLocation.name}</h2><p className="mt-1 text-pretty text-sm text-ink/65">นับแบบไม่แสดงยอดคาดการณ์ รายการที่เกิดหลังเวลาเริ่มจะเข้ารอบถัดไป</p></div>
          <button type="button" onClick={() => void loadSession()} disabled={!online || loading} className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><RotateCw size={16} className={loading ? "animate-spin" : ""} />รีเฟรช</button>
        </div>

        {loading ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-lg bg-mint/50" /><div className="h-20 animate-pulse rounded-lg bg-mint/50" /><div className="h-20 animate-pulse rounded-lg bg-mint/50" /></div>
        : receipt ? <div className="mt-5 rounded-lg border border-leaf/20 bg-mint/45 p-4"><h3 className="font-bold text-ink">ส่งผลตรวจนับสำเร็จ</h3><p className="mt-1 text-sm text-ink/70">{receipt.reportNo} · {dateTime(receipt.submittedAt)} · {receipt.countedByName}</p><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-9">{CASH_DENOMINATIONS.map((d) => <div key={d} className="rounded-md bg-white p-2 text-center"><div className="text-xs text-ink/55">฿{d}</div><div className="font-bold">{receipt.actualCounts[String(d)]}</div></div>)}</div><div className="mt-4 text-right text-lg font-bold text-ink">รวม {money(receipt.actualTotal)} บาท</div><button type="button" onClick={() => setReceipt(null)} className="focus-ring mt-4 rounded-md bg-leaf px-4 py-2 text-sm font-semibold text-white">กลับหน้าเริ่มนับ</button></div>
        : !session ? <div className="mt-5 rounded-lg bg-mint/35 p-5 text-center"><Banknote className="mx-auto text-leaf" size={32} /><h3 className="mt-2 font-bold text-ink">พร้อมเริ่มตรวจนับเงินสด</h3><p className="mt-1 text-pretty text-sm text-ink/65">ระบบจะยึดเวลา server ตอนเริ่มและให้กรอกภายใน 30 นาที</p><button type="button" onClick={() => void start()} disabled={!online || working} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-md bg-leaf px-5 py-2.5 font-semibold text-white disabled:opacity-50">{working && <Loader2 size={16} className="animate-spin" />}เริ่มนับเงิน</button></div>
        : !session.isOwner ? <div className="mt-5 rounded-lg bg-amber/20 p-4 text-sm font-semibold text-ink">{session.startedByName} กำลังตรวจนับสาขานี้ · เหลือ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} นาที</div>
        : secondsLeft <= 0 ? <div className="mt-5 rounded-lg bg-clay/10 p-4"><h3 className="font-bold text-clay">ช่วงตรวจนับหมดเวลาแล้ว</h3><p className="mt-1 text-sm text-ink/70">ผลเดิมส่งไม่ได้ กรุณารีเฟรชและเริ่มรอบใหม่</p></div>
        : <div className="mt-5"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold text-ink">Cutoff {dateTime(session.cutoffAt)}</span><span className="rounded-md bg-amber/20 px-3 py-1 font-bold text-amber-900">เหลือ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} นาที</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{CASH_DENOMINATIONS.map((d) => <label key={d} className="rounded-lg border border-black/10 bg-field p-3"><span className="text-sm font-semibold text-ink">{d >= 20 ? "ธนบัตร" : "เหรียญ"} {d} บาท</span><div className="mt-2"><InlineNumber value={values[d]} integerOnly ariaLabel={`จำนวนเงินชนิด ${d} บาท`} onChange={(value) => { setSubmitError(null); setValues((current) => ({ ...current, [d]: value })); }} /></div></label>)}</div><div className="mt-4 flex flex-col gap-3 rounded-lg bg-mint/45 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm text-ink/60">ยอดรวมที่กรอก</div><div className="text-2xl font-bold text-ink">{money(actualTotal)} บาท</div></div><div className="flex gap-2"><button type="button" onClick={() => setConfirmMode("cancel")} className="focus-ring inline-flex items-center gap-1 rounded-md border border-clay px-4 py-2 font-semibold text-clay"><X size={16} />ยกเลิก</button><button type="button" onClick={() => setConfirmMode("submit")} disabled={!complete || working} className="focus-ring rounded-md bg-leaf px-5 py-2 font-semibold text-white disabled:opacity-50">ยืนยันและส่งผล</button></div></div>{submitError && <p role="alert" className="mt-2 text-pretty text-sm font-medium text-clay">{submitError}</p>}{!complete && <p className="mt-2 text-pretty text-sm text-clay">กรุณากรอกครบทั้ง 9 ชนิด รวมถึงระบุ 0 อย่างชัดเจน</p>}</div>}
      </div>

      {manager && (
        <>
        <div className="flex flex-wrap gap-2" aria-label="มุมมองผลตรวจนับ">
          {([
            ["current", "ผลตรวจนับ"],
            ["deletions", "ประวัติการลบ"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setHistoryView(value);
              }}
              className={cn(
                "focus-ring rounded-md px-4 py-2 text-sm font-semibold text-white",
                historyView === value ? "bg-leaf" : "bg-actionSecondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {historyView === "current" ? <div className="rounded-xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-black/5 p-4">
            <div><h3 className="font-bold text-ink">ประวัติผลตรวจนับสาขานี้</h3><p className="text-sm text-ink/60">แสดงทีละสาขาตามตัวเลือกหลักของแอป</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-mint/50 text-left"><tr><th className="px-4 py-3">จัดการ</th><th className="px-4 py-3">รายงาน</th><th className="px-4 py-3">ผู้ตรวจ</th><th className="px-4 py-3 text-right">จริง / คาดการณ์</th><th className="px-4 py-3">ผลวิเคราะห์</th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {history.length === 0 && <tr><td colSpan={5} className="px-4 py-7 text-center text-ink/55">ยังไม่มีผลตรวจนับ</td></tr>}
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3"><div className="flex gap-1.5 whitespace-nowrap">
                      <button type="button" onClick={() => void loadDetail(item.id).catch((error) => toast.error(error instanceof Error ? error.message : "โหลดรายละเอียดไม่สำเร็จ"))}
                        title="ดูรายละเอียด" aria-label="ดูรายละเอียด"
                        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-white"><Eye size={17} /></button>
                      {history[0]?.id === item.id && (
                        <button type="button" onClick={() => { setDeleteTarget(item); setConfirmMode("delete"); }}
                          title="ลบชุดล่าสุด" aria-label="ลบชุดล่าสุด"
                          className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 font-semibold text-white"><Trash2 size={16} />ลบ</button>
                      )}
                    </div></td>
                    <td className="px-4 py-3"><div className="font-semibold">{item.reportNo}</div><div className="text-xs">{dateTime(item.createdAt)}</div></td>
                    <td className="px-4 py-3">{item.createdByName}</td>
                    <td className="px-4 py-3 text-right">{money(item.actualTotal)} / {money(item.expectedTotal)}</td>
                    <td className="px-4 py-3">{statusLabel(item.analysisStatus)}{item.anomalyScore != null && <div className="text-xs">คะแนน {item.anomalyScore} · มั่นใจ {item.confidence}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div> : (
          <div className="space-y-3">
          <DeletionAuditTable
            rows={deletions}
            loading={deletionsLoading}
            emptyLabel="ยังไม่มีประวัติการลบชุดตรวจนับ"
            originalActorLabel="ผู้ตรวจเดิม"
            onShowCurrent={() => setHistoryView("current")}
          />
          {deletionsHasMore && deletionsCursor && !deletionsLoading && (
            <div className="flex justify-center"><button type="button" onClick={() => void loadDeletions(deletionsCursor, true)} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดประวัติเพิ่ม</button></div>
          )}
          </div>
        )}
        </>
      )}

      {manager && detail && <div className="rounded-xl border border-black/10 bg-white p-4 shadow-panel sm:p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-balance text-lg font-bold text-ink">รายละเอียด {detail.reportNo}</h3><p className="mt-1 text-sm text-ink/60">สูตร {detail.formulaVersion} · {statusLabel(detail.analysisStatus)}</p></div><button type="button" onClick={() => setDetail(null)} aria-label="ปิดรายละเอียด" className="focus-ring rounded-md p-2 text-ink/60"><X size={18} /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-field p-3"><div className="text-xs text-ink/55">ยอดจริง</div><div className="text-lg font-bold">{money(detail.actualTotal)}</div></div><div className="rounded-lg bg-field p-3"><div className="text-xs text-ink/55">ยอดคาดการณ์</div><div className="text-lg font-bold">{money(detail.expectedTotal)}</div></div><div className="rounded-lg bg-field p-3"><div className="text-xs text-ink/55">ส่วนต่าง</div><div className="text-lg font-bold">{money(detail.differenceTotal)}</div></div></div><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-9">{CASH_DENOMINATIONS.map((d) => <div key={d} className="rounded-md border border-black/5 p-2 text-center"><div className="text-xs text-ink/50">฿{d}</div><div className="font-bold">{detail.actualCounts[String(d)]}</div><div className="text-xs text-ink/55">คาด {detail.expectedCounts[String(d)]}</div></div>)}</div><div className="mt-5 grid gap-4 lg:grid-cols-2"><div><h4 className="font-bold text-ink">ประเด็นสำคัญ</h4><ul className="mt-2 space-y-1 text-sm text-ink/75">{detail.evidence.highlights?.map((item) => <li key={item}>• {item}</li>)}</ul></div><div><h4 className="font-bold text-ink">ข้อจำกัดการคำนวณ</h4><ul className="mt-2 space-y-1 text-sm text-ink/75">{detail.evidence.limitations?.map((item) => <li key={item}>• {item}</li>)}</ul></div></div><details className="mt-5 rounded-lg border border-black/10 p-3"><summary className="cursor-pointer font-semibold text-ink">รายการอ้างอิง ({detail.evidence.references?.length ?? 0})</summary><div className="mt-3 space-y-2 text-sm text-ink/70">{detail.evidence.references?.map((item, index) => <div key={`${String(item.id ?? "ref")}-${index}`} className="rounded-md bg-field p-2">{String(item.label ?? item.source ?? "รายการ")} · {money(Number(item.amount ?? 0))} บาท</div>)}</div></details></div>}

      <ConfirmDialog open={confirmMode === "submit"} title="ยืนยันผลตรวจนับ" description={`จำนวนที่กรอกครบ 9 ชนิด รวม ${money(actualTotal)} บาท หลังส่งแล้วแก้ไขไม่ได้`} detail={<div className="mt-3 grid grid-cols-3 gap-2">{CASH_DENOMINATIONS.map((d) => <div key={d} className="rounded-md bg-field p-2 text-center text-sm"><div className="text-xs text-ink/50">฿{d}</div><div className="font-bold text-ink">{values[d] === "" ? "-" : values[d]}</div></div>)}</div>} confirmLabel="ส่งผลตรวจนับ" busy={working} onCancel={() => setConfirmMode(null)} onConfirm={() => void submit()} />
      <ConfirmDialog open={confirmMode === "cancel"} title="ยกเลิกช่วงตรวจนับ" description="ค่าที่กรอกในหน้านี้จะหาย และต้องเริ่มช่วงตรวจนับใหม่" confirmLabel="ยกเลิกช่วงนี้" busy={working} onCancel={() => setConfirmMode(null)} onConfirm={() => void cancel()} />
      <ConfirmDialog open={confirmMode === "delete"} title="ลบชุดตรวจนับและรายงาน" description={`${deleteTarget?.reportNo ?? "ชุดนี้"} ผลตรวจนับ รายละเอียดเงินสด และรายงานคู่จะถูกลบถาวรและกู้คืนไม่ได้ ระบบจะเก็บเฉพาะประวัติการลบขั้นต่ำ`} confirmLabel="ลบทั้งชุด" busy={working} onCancel={() => { setConfirmMode(null); setDeleteTarget(null); }} onConfirm={() => void removeCount()} />
    </section>
  );
}
