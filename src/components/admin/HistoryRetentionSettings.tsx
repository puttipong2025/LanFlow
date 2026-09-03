"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ApiResponseError, assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { AlertDialog } from "@/components/shared/AlertDialog";
import type { HistoryCleanupStatus, HistoryRetentionOverview } from "@/types/history-retention";

const GROUP_LABELS: Record<string, { label: string; detail: string }> = {
  dashboard_money_events: { label: "ประวัติรายการเงินล่าสุด", detail: "เหตุการณ์เพิ่ม แก้ไข และลบบน Dashboard" },
  time_tracking_audit_logs: { label: "ประวัติเวลาและเงินเดือน", detail: "Audit การจัดการเวลา การลา ค่าแรง และช่วงทำงาน" },
  admin_account_audit_logs: { label: "ประวัติจัดการบัญชี", detail: "รายการที่สำเร็จ ล้มเหลว หรือไม่ทราบผล; pending ยังไม่ถูกลบ" },
  income_expense_approval_requests: { label: "คำขออนุมัติรับ–จ่าย", detail: "เฉพาะคำขอที่อนุมัติ ปฏิเสธ หรือยกเลิกแล้ว" },
  cash_transfer_delete_requests: { label: "คำขอลบรายการโยกเงิน", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  rubber_bill_approval_requests: { label: "คำขออนุมัติบิลยาง", detail: "เฉพาะคำขอที่สิ้นสุดแล้ว ไม่ลบบิลจริง" },
  stock_entry_approval_requests: { label: "คำขออนุมัติรายการสต็อก", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  stock_product_approval_requests: { label: "คำขออนุมัติสินค้า", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  scheduler_run_history: { label: "ประวัติการทำงานอัตโนมัติ", detail: "เฉพาะรอบ Scheduler ที่สิ้นสุดแล้ว ไม่ลบตัวงานหรือกำหนดเวลา" },
  cleanup_run_history: { label: "ประวัติการล้างข้อมูล", detail: "ผลการล้างแต่ละรอบ ไม่รวมหลักฐานการเปลี่ยนค่า" },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })
    .format(new Date(`${value}T00:00:00+07:00`));
}

async function readResponse<T = HistoryRetentionOverview>(response: Response) {
  await assertApiResponse(response);
  return response.json() as Promise<T>;
}

type Confirmation = { data: HistoryRetentionOverview } & (
  { kind: "save" } | { kind: "cleanup"; requestId: string }
);

export function HistoryRetentionSettings() {
  const [overview, setOverview] = useState<HistoryRetentionOverview | null>(null);
  const [preview, setPreview] = useState<HistoryRetentionOverview | null>(null);
  const [days, setDays] = useState(15);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Confirmation | null>(null);
  const version = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const currentOverview = useRef<HistoryRetentionOverview | null>(null);

  const handleAccessFailure = useCallback((failure: unknown) => {
    if (!(failure instanceof ApiResponseError) || (failure.status !== 401 && failure.status !== 403)) return false;
    currentOverview.current = null;
    setOverview(null);
    setPreview(null);
    setDialog(null);
    setPollError(null);
    setError(failure.message);
    return true;
  }, []);

  const applyOverview = useCallback((data: HistoryRetentionOverview, resetDraft: boolean) => {
    const previousDays = currentOverview.current?.currentDays;
    currentOverview.current = data;
    setOverview(data);
    setDays((value) => resetDraft || value === previousDays ? data.currentDays : value);
    setPreview(null);
  }, []);

  const load = useCallback(async (resetDraft = true, quiet = false) => {
    const ticket = ++version.current;
    if (!quiet) { setLoading(true); setError(null); }
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", { cache: "no-store" }));
      if (!mounted.current || ticket !== version.current) return;
      applyOverview(data, resetDraft);
      setPollError(null);
    } catch (loadError) {
      if (mounted.current && ticket === version.current) {
        if (handleAccessFailure(loadError)) return;
        const message = loadError instanceof Error ? loadError.message : "โหลดการตั้งค่าไม่สำเร็จ";
        if (quiet) {
          setPollError(message);
          // Rearm status polling even when the follow-up full refresh failed.
          setOverview((previous) => previous ? { ...previous } : previous);
        } else setError(message);
      }
    } finally {
      if (mounted.current && ticket === version.current) setLoading(false);
    }
  }, [applyOverview, handleAccessFailure]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; version.current += 1; };
  }, [load]);

  // Poll metadata only, never the full count preview. Timer cleanup prevents overlaps.
  useEffect(() => {
    if (!overview || working || dialog) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (document.hidden || !navigator.onLine) {
        if (!controller.signal.aborted) setOverview((previous) => previous ? { ...previous } : previous);
        return;
      }
      const ticket = version.current;
      try {
        const response = await authFetch("/api/lanflow/admin/history-retention?view=status", { cache: "no-store", signal: controller.signal });
        const data = await readResponse<HistoryCleanupStatus>(response);
        if (controller.signal.aborted || ticket !== version.current || !mounted.current) return;
        setPollError(null);
        const policyChanged = data.updatedAt !== overview.updatedAt || data.cutoffDate !== overview.cutoffDate;
        const jobFinished = overview.lastCleanup?.status === "running" && data.lastCleanup?.status !== "running";
        if (policyChanged || jobFinished) {
          await load(false, true);
        } else {
          const next = { ...overview, lastCleanup: data.lastCleanup };
          currentOverview.current = next;
          setOverview(next);
        }
      } catch (pollFailure) {
        if (!controller.signal.aborted && ticket === version.current && mounted.current) {
          if (handleAccessFailure(pollFailure)) return;
          setPollError(pollFailure instanceof Error ? pollFailure.message : "อ่านสถานะงานไม่สำเร็จ");
          setOverview((previous) => previous ? { ...previous } : previous);
        }
      }
    }, 5000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [overview, working, dialog, load, handleAccessFailure]);

  async function requestPreview() {
    if (busy.current) return;
    if (!Number.isInteger(days) || days < 1 || days > 365) { setError("จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365"); return; }
    busy.current = true;
    const ticket = ++version.current;
    setWorking(true);
    setError(null);
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", retentionDays: days }),
      }));
      if (mounted.current && ticket === version.current) setPreview(data);
    } catch (failure) {
      if (mounted.current && ticket === version.current && !handleAccessFailure(failure)) {
        setError(failure instanceof Error ? failure.message : "คำนวณผลกระทบไม่สำเร็จ");
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  async function openCleanup() {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++version.current;
    setWorking(true);
    setError(null);
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", { cache: "no-store" }));
      if (!mounted.current || ticket !== version.current) return;
      applyOverview(data, false);
      if (data.lastCleanup?.status === "running") { toast.info("มีงานล้างกำลังดำเนินการอยู่แล้ว"); return; }
      setDialog({ kind: "cleanup", data, requestId: crypto.randomUUID() });
    } catch (failure) {
      if (mounted.current && ticket === version.current && !handleAccessFailure(failure)) {
        setError(failure instanceof Error ? failure.message : "ตรวจข้อมูลก่อนล้างไม่สำเร็จ");
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  async function confirmAction() {
    if (!dialog || busy.current) return;
    busy.current = true;
    const ticket = ++version.current;
    setWorking(true);
    setError(null);
    try {
      const response = await authFetch("/api/lanflow/admin/history-retention", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dialog.kind === "cleanup" ? {
          action: "cleanup", requestId: dialog.requestId,
          expectedUpdatedAt: dialog.data.updatedAt, cutoffDate: dialog.data.cutoffDate,
        } : {
          action: "save", retentionDays: dialog.data.requestedDays, expectedUpdatedAt: dialog.data.updatedAt,
        }),
      });
      const data = await readResponse(response);
      if (!mounted.current || ticket !== version.current) return;
      if (dialog.kind === "save") applyOverview(data, true);
      setDialog(null);
      toast.success(dialog.kind === "cleanup" ? "รับคำสั่งล้างแล้ว ปิดหน้าเว็บได้ ระบบจะทำต่อเบื้องหลัง" : "บันทึกระยะเก็บประวัติแล้ว งานล้างจะใช้ค่าล่าสุด");
      if (dialog.kind === "cleanup") await load(false, true);
    } catch (failure) {
      if (mounted.current && ticket === version.current && !handleAccessFailure(failure)) {
        const message = failure instanceof Error ? failure.message : "ส่งคำสั่งไม่สำเร็จ";
        setError(message);
        if (failure instanceof ApiResponseError && failure.status === 409) { setDialog(null); await load(false, true); }
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  if (loading) return <section className="rounded-md border border-black/10 bg-white p-6 shadow-panel" role="status">กำลังโหลดการตั้งค่าประวัติ...</section>;
  if (!overview) return <section className="rounded-md border border-rose-200 bg-white p-6 shadow-panel"><p className="text-rose-700">{error ?? "โหลดการตั้งค่าไม่สำเร็จ"}</p><button type="button" onClick={() => void load()} className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-black/15 px-3 font-semibold"><RefreshCw size={16} />ลองใหม่</button></section>;

  const shown = preview ?? overview;
  const dirty = days !== overview.currentDays;
  return <div className="space-y-5">
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="flex items-center gap-2 text-balance text-lg font-bold text-ink"><Database size={19} />ระยะเก็บประวัติชั่วคราว</h3><p className="mt-1 text-pretty text-sm text-ink/60">ใช้ค่าเดียวทั้งระบบ นับเป็นวันปฏิทิน Asia/Bangkok</p></div>
        <span className="rounded-md bg-field px-3 py-1.5 text-sm font-semibold tabular-nums">ปัจจุบัน {overview.currentDays} วัน</span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-3">
          <label className="grid gap-1 text-sm font-semibold" htmlFor="history-retention-days">จำนวนวันที่เก็บ
            <input id="history-retention-days" type="number" inputMode="numeric" min={1} max={365} value={days} disabled={working}
              onChange={(event) => { setDays(Number(event.target.value)); setPreview(null); setError(null); }}
              aria-describedby="history-retention-hint" className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field" />
          </label>
          <p id="history-retention-hint" className="text-pretty text-sm text-ink/60">กำหนดได้ 1–365 วัน เช่น 15 วันหมายถึงวันนี้และ 14 วันก่อนหน้า</p>
          {error && !dialog && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working || !dirty} onClick={() => void requestPreview()} className="focus-ring h-10 rounded-md border border-river/30 px-3 text-sm font-bold text-river disabled:cursor-not-allowed disabled:opacity-50">{working ? "กำลังตรวจ..." : "ตรวจผลกระทบ"}</button>
            <button type="button" disabled={working || !dirty || !preview || preview.requestedDays !== days} onClick={() => { if (preview) setDialog({ kind: "save", data: preview }); }} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">บันทึกค่า</button>
          </div>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-start gap-2 font-semibold text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={17} />การลบประวัติเป็นการลบถาวร</p>
          <p className="mt-2 text-pretty text-sm text-amber-900/80">เมื่อลดวัน รายการนอกช่วงจะหยุดแสดงทันทีและทยอยลบเป็นรอบย่อย การเพิ่มวันภายหลังไม่สามารถกู้รายการที่ลบแล้วกลับมาได้</p>
        </div>
      </div>
    </section>

    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-balance font-bold text-ink">ข้อมูลที่ได้รับผลกระทบ</h3><p className="text-pretty text-sm tabular-nums text-ink/60">เก็บตั้งแต่วันที่ {formatDate(shown.cutoffDate)} · เข้าเกณฑ์ลบ {shown.totalEligible.toLocaleString("th-TH")} รายการ</p></div>{preview && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">ตัวอย่างก่อนบันทึก</span>}</div>
      <div className="mt-3 overflow-x-auto" role="region" aria-label="ผลกระทบและความคืบหน้าแยกกลุ่ม" tabIndex={0}><table className="w-full min-w-[42rem] text-left text-sm"><thead><tr className="border-b border-black/10 text-ink/60"><th className="p-3">กลุ่มข้อมูล</th><th className="p-3 text-right">เข้าเกณฑ์ลบ</th><th className="p-3">วันที่เก่าสุด</th>{!preview && overview.lastCleanup && <><th className="p-3 text-right">ลบแล้วในงานล่าสุด</th><th className="p-3 text-right">ค้างในงานล่าสุด ≈</th></>}</tr></thead><tbody className="divide-y divide-black/5">{shown.groups.map((group) => { const copy = GROUP_LABELS[group.key] ?? { label: group.key, detail: "ประวัติชั่วคราว" }; return <tr key={group.key}><td className="p-3"><p className="font-semibold text-ink">{copy.label}</p><p className="text-pretty text-xs text-ink/55">{copy.detail}</p></td><td className="p-3 text-right font-semibold tabular-nums">{group.eligibleCount.toLocaleString("th-TH")}</td><td className="p-3 tabular-nums">{formatDate(group.oldestDate)}</td>{!preview && overview.lastCleanup && <><td className="p-3 text-right tabular-nums">{(overview.lastCleanup.deletedCounts[group.key] ?? 0).toLocaleString("th-TH")}</td><td className="p-3 text-right tabular-nums">{(overview.lastCleanup.remainingCounts[group.key] ?? 0).toLocaleString("th-TH")}</td></>}</tr>; })}</tbody></table></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4"><h3 className="flex items-center gap-2 text-balance font-bold text-emerald-900"><ShieldCheck size={18} />ไม่ลบและไม่กระทบ</h3><ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-emerald-950/80"><li>บิลยางและรับ–จ่ายสถานะ <code>deleted</code> รวมเลขเอกสารและ revision</li><li>Dashboard ยอดรับ–จ่ายสะสม ยอดซื้อยาง และยอดสต็อก</li><li>ข้อมูลธุรกิจ รายงาน Payroll Slip และ relation lock</li><li>หลักฐานลบ RPT, REX, Cash Count และ WEX แบบถาวร</li><li>Auth audit, Realtime message และ platform log ที่ผู้ให้บริการจัดการ</li></ul></div>
      <div className="rounded-md border border-black/10 bg-white p-4">
        <h3 className="flex items-center gap-2 text-balance font-bold text-ink"><CheckCircle2 size={18} className="text-leaf" />สถานะงานล้างประวัติ</h3>
        <p className="mt-2 text-pretty text-sm text-ink/60">ระบบตรวจทุกนาทีและล้างทีละชุด ปิดหน้าเว็บได้โดยงานไม่หยุด</p>
        {overview.lastCleanup ? <div className="mt-3 space-y-1 text-sm tabular-nums" role="status">
          <p>งานล่าสุด: <strong>{overview.lastCleanup.status === "succeeded" ? "สำเร็จ" : overview.lastCleanup.status === "failed" ? "ไม่สำเร็จ — ระบบจะลองใหม่ในรอบถัดไป" : overview.lastCleanup.batches === 0 ? "รับงานแล้ว — รอรอบล้าง" : "กำลังล้างเป็นชุด"}</strong></p>
          <p>ลบแล้ว {Object.values(overview.lastCleanup.deletedCounts).reduce((sum, value) => sum + value, 0).toLocaleString("th-TH")} รายการ · {overview.lastCleanup.batches.toLocaleString("th-TH")} ชุด</p>
          <p>ยังมีรายการรอล้าง: {overview.lastCleanup.hasMore ? "มี" : "ไม่มี"}</p>
          <p className="text-pretty text-xs text-ink/60">จำนวนค้าง ≈ เป็นค่าประมาณจากการตรวจต้นงาน ปรับใหม่เมื่อเปลี่ยนวัน; คอลัมน์เข้าเกณฑ์ลบเป็นผลตรวจล่าสุด กดตรวจข้อมูลล่าสุดเพื่อคำนวณใหม่</p>
          {overview.lastCleanup.errorMessage && <p className="text-pretty text-rose-700">{overview.lastCleanup.errorMessage}</p>}
        </div> : <p className="mt-3 text-pretty text-sm text-ink/60">ยังไม่มีประวัติงานล้าง</p>}
        {pollError && <p role="alert" className="mt-3 text-pretty text-sm text-rose-700">{pollError} {overview.lastCleanup ? "งานที่รับไว้ยังอยู่บน Server" : "กรุณาลองตรวจข้อมูลล่าสุดอีกครั้ง"}</p>}
        {dirty && <p className="mt-3 text-pretty text-sm text-ink/60">บันทึกจำนวนวันหรือคืนค่าเดิมก่อนสั่งล้าง</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={working || dirty || overview.lastCleanup?.status === "running"} onClick={() => void openCleanup()}
            className="focus-ring min-h-10 rounded-md bg-clay px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">ล้างประวัติที่หมดอายุตอนนี้</button>
          <button type="button" disabled={working} onClick={() => void load(false, true)}
            className="focus-ring min-h-10 rounded-md border border-black/15 px-3 py-2 text-sm font-semibold disabled:opacity-50">ตรวจข้อมูลล่าสุด</button>
        </div>
      </div>
    </section>
    <AlertDialog open={dialog !== null} title={dialog?.kind === "cleanup" ? "ยืนยันล้างประวัติที่หมดอายุ?" : "ยืนยันเปลี่ยนระยะเก็บประวัติ?"}
      description={dialog?.kind === "cleanup"
        ? `ใช้ค่าที่บันทึกแล้ว ${dialog.data.currentDays} วัน เก็บตั้งแต่ ${formatDate(dialog.data.cutoffDate)} ลบเฉพาะประวัตินอกช่วง ไม่ลบข้อมูลธุรกิจหรือยอดสะสม การลบถาวรไม่สามารถย้อนกลับด้วยการเพิ่มจำนวนวัน`
        : `เปลี่ยนเป็น ${dialog?.data.requestedDays ?? days} วัน มีผลกับรอบล้างถัดไป การเพิ่มวันไม่คืนประวัติที่ลบแล้ว`}
      confirmLabel={dialog?.kind === "cleanup" ? "ยืนยันเริ่มล้าง" : "ยืนยันเปลี่ยนค่า"} busy={working}
      onCancel={() => { setDialog(null); setError(null); }} onConfirm={() => void confirmAction()}>
      {dialog && <div className="mt-3 max-h-56 overflow-y-auto text-sm">
        <p className="font-semibold tabular-nums">เข้าเกณฑ์ลบ {dialog.data.totalEligible.toLocaleString("th-TH")} รายการ</p>
        <ul className="mt-2 space-y-1">{dialog.data.groups.map((group) => <li key={group.key} className="flex justify-between gap-3">
          <span>{GROUP_LABELS[group.key]?.label ?? group.key}</span><span className="shrink-0 tabular-nums">{group.eligibleCount.toLocaleString("th-TH")}</span>
        </li>)}</ul>
      </div>}
      {error && <p role="alert" className="mt-3 text-pretty text-sm text-rose-700">{error}</p>}
    </AlertDialog>
  </div>;
}
