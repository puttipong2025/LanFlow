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
import { ModalShell } from "@/components/shared/ModalShell";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures } from "@/lib/permissions";
import { getPendingEvents } from "@/lib/idb-queue";
import { BankBalanceList, type BankSlot } from "./BankBalanceList";
import { CashCountReceiptPanel } from "./CashCountReceiptPanel";
import { CashCountDetails } from "./CashCountDetails";
import { cn } from "@/lib/cn";
import { showPendingWorkBlockedToast } from "@/components/shared/PendingWorkBlockedToast";
import { parsePendingWorkApiBody } from "@/lib/pending-work-blockers";

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
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
      cancelClassName="min-h-11 border-transparent bg-actionSecondary text-white"
      confirmClassName={confirmLabel === "ส่งผลตรวจนับ" ? "min-h-11 bg-leaf" : "min-h-11 bg-clay"}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {detail}
    </AlertDialog>
  );
}

export function CashCountModule({ selectedLocation, profile, online }: {
  selectedLocation: Location; profile: Profile; online: boolean;
}) {
  const [banks, setBanks] = useState<BankSlot[]>([]);
  const bankTotal = banks.reduce((total, slot) => total + Math.round((slot.value?.amount ?? 0) * 100), 0) / 100;
  const bankBlocked = banks.some((slot) => slot.blocked || !slot.value?.confirmed);
  const [session, setSession] = useState<CashCountSession | null>(null);
  const [receipt, setReceipt] = useState<CashCountReceipt | null>(null);
  const [values, setValues] = useState<Record<CashDenomination, number>>(() => Object.fromEntries(CASH_DENOMINATIONS.map((d) => [d, 0])) as Record<CashDenomination, number>);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<{ message: string; includeDeletions: boolean } | null>(null);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"submit" | "cancel" | "delete" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashCountSummary | null>(null);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<CashCountSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [deletions, setDeletions] = useState<DocumentDeletionAudit[]>([]);
  const [historyView, setHistoryView] = useState<"current" | "deletions">("current");
  const [deletionsLoading, setDeletionsLoading] = useState(false);
  const [deletionsHasMore, setDeletionsHasMore] = useState(false);
  const [deletionsCursor, setDeletionsCursor] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; reportNo?: string } | null>(null);
  const [detail, setDetail] = useState<CashCountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailLocationIdRef = useRef(selectedLocation.id);
  const locationIdRef = useRef(selectedLocation.id);
  const sessionRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const deletionRequestIdRef = useRef(0);
  const mutationRequestIdRef = useRef(0), mutationLockRef = useRef(false);
  const historyRefreshRequestIdRef = useRef(0);
  locationIdRef.current = selectedLocation.id;
  const manager = canManageSystemFeatures(profile);

  const resetForm = useCallback(() => { setBanks([]); setValues(Object.fromEntries(CASH_DENOMINATIONS.map((d) => [d, 0])) as Record<CashDenomination, number>); }, []);
  const loadSession = useCallback(async () => {
    if (!online) return;
    const requestId = ++sessionRequestIdRef.current;
    const locationId = selectedLocation.id;
    setLoading(true);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/session?locationId=${encodeURIComponent(locationId)}`, { cache: "no-store" });
      await assertApiResponse(response);
      const body = await response.json() as { session: CashCountSession | null };
      if (requestId !== sessionRequestIdRef.current || locationIdRef.current !== locationId) return;
      setSession(body.session);
    } catch (error) {
      if (requestId !== sessionRequestIdRef.current || locationIdRef.current !== locationId) return;
      toast.error(error instanceof Error ? error.message : "โหลดสถานะตรวจนับไม่สำเร็จ");
    } finally {
      if (requestId === sessionRequestIdRef.current && locationIdRef.current === locationId) setLoading(false);
    }
  }, [online, selectedLocation.id]);

  const loadHistory = useCallback(async (cursor: string | null = null, append = false) => {
    if (!online || !manager) return;
    const requestId = ++historyRequestIdRef.current;
    const locationId = selectedLocation.id;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ locationId });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(`/api/lanflow/cash-counts?${params.toString()}`, { cache: "no-store" });
      await assertApiResponse(response);
      const body = (await response.json()) as {
        counts: CashCountSummary[];
        hasMore?: boolean;
        nextCursor?: string | null;
      };
      if (requestId !== historyRequestIdRef.current || locationIdRef.current !== locationId) return;
      setHistory((current) => append
        ? [...current, ...body.counts.filter((row) => !current.some((item) => item.id === row.id))]
        : body.counts);
      setHistoryHasMore(body.hasMore === true);
      setHistoryCursor(body.nextCursor ?? null);
    } catch (error) {
      if (requestId !== historyRequestIdRef.current || locationIdRef.current !== locationId) return;
      throw error;
    } finally {
      if (requestId === historyRequestIdRef.current && locationIdRef.current === locationId) setHistoryLoading(false);
    }
  }, [manager, online, selectedLocation.id]);

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestIdRef.current;
    const locationId = selectedLocation.id;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/${id}?locationId=${encodeURIComponent(locationId)}`, { cache: "no-store" });
      await assertApiResponse(response);
      const body = await response.json() as CashCountDetail;
      if (requestId !== detailRequestIdRef.current || locationIdRef.current !== locationId) return;
      setDetail(body);
    } catch (error) {
      if (requestId !== detailRequestIdRef.current || locationIdRef.current !== locationId) return;
      setDetailError(error instanceof Error ? error.message : "โหลดรายละเอียดไม่สำเร็จ");
    } finally {
      if (requestId === detailRequestIdRef.current && locationIdRef.current === locationId) setDetailLoading(false);
    }
  }, [selectedLocation.id]);

  const openDetail = useCallback((id: string, reportNo?: string) => {
    setDetailTarget({ id, reportNo });
    setDetail(null);
    void loadDetail(id);
  }, [loadDetail]);

  const closeDetail = useCallback(() => {
    detailRequestIdRef.current += 1;
    setDetailTarget(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }, []);

  const loadDeletions = useCallback(async (cursor: string | null = null, append = false) => {
    if (!online || !manager) return;
    const requestId = ++deletionRequestIdRef.current;
    const locationId = selectedLocation.id;
    setDeletionsLoading(true);
    try {
      const params = new URLSearchParams({ locationId, view: "deletions" });
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
      if (requestId !== deletionRequestIdRef.current || locationIdRef.current !== locationId) return;
      setDeletions((current) => append
        ? [...current, ...body.deletions.filter((row) => !current.some((item) => item.id === row.id))]
        : body.deletions);
      setDeletionsHasMore(body.hasMore);
      setDeletionsCursor(body.nextCursor);
    } catch (error) {
      if (requestId !== deletionRequestIdRef.current || locationIdRef.current !== locationId) return;
      throw error;
    } finally {
      if (requestId === deletionRequestIdRef.current && locationIdRef.current === locationId) setDeletionsLoading(false);
    }
  }, [manager, online, selectedLocation.id]);

  async function refreshHistory(includeDeletions: boolean, confirmedAction?: string) {
    const requestId = ++historyRefreshRequestIdRef.current;
    const locationId = selectedLocation.id;
    setHistoryRefreshing(true);
    try {
      await Promise.all([loadHistory(), ...(includeDeletions ? [loadDeletions()] : [])]);
      if (requestId === historyRefreshRequestIdRef.current && locationIdRef.current === locationId) setHistoryWarning(null);
    } catch (error) {
      if (requestId !== historyRefreshRequestIdRef.current || locationIdRef.current !== locationId) return;
      setHistoryWarning({
        message: `${confirmedAction ? `${confirmedAction} แต่` : ""}โหลดประวัติใหม่ไม่สำเร็จ${error instanceof Error ? `: ${error.message}` : ""}`,
        includeDeletions,
      });
    } finally {
      if (requestId === historyRefreshRequestIdRef.current && locationIdRef.current === locationId) setHistoryRefreshing(false);
    }
  }

  useEffect(() => {
    const detailLocationChanged = detailLocationIdRef.current !== selectedLocation.id;
    detailLocationIdRef.current = selectedLocation.id;
    setSession(null);
    setReceipt(null);
    if (detailLocationChanged) {
      setDetailTarget(null);
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
    }
    setHistory([]);
    setHistoryLoading(false);
    setHistoryHasMore(false);
    setHistoryCursor(null);
    setDeletions([]);
    setWorking(false);
    setConfirmMode(null);
    setDeleteTarget(null);
    setSubmitError(null);
    setHistoryWarning(null);
    setHistoryRefreshing(false);
    setDeletionsHasMore(false);
    setDeletionsCursor(null);
    resetForm();
    void loadSession();
    return () => {
      sessionRequestIdRef.current += 1;
      historyRequestIdRef.current += 1;
      deletionRequestIdRef.current += 1;
      mutationRequestIdRef.current += 1;
      historyRefreshRequestIdRef.current += 1;
    };
  }, [loadSession, resetForm, selectedLocation.id]);
  useEffect(() => {
    if (!manager) return;
    if (historyView === "deletions") {
      void loadDeletions().catch((error) => toast.error(error instanceof Error ? error.message : "โหลดประวัติการลบไม่สำเร็จ"));
      return;
    }
    void loadHistory().catch((error) => toast.error(
      error instanceof Error ? error.message : "โหลดประวัติไม่สำเร็จ",
    ));
  }, [historyView, loadDeletions, loadHistory, manager, selectedLocation.id]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);


  const secondsLeft = session ? Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000)) : 0;
  const actualTotal = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + values[d] * d, 0), [values]);

  async function start() {
    if (!online || mutationLockRef.current) return; mutationLockRef.current = true;
    const requestId = ++mutationRequestIdRef.current;
    const locationId = selectedLocation.id;
    setWorking(true);
    setSubmitError(null);
    try {
      const [rubberQueue, incomeQueue] = await Promise.all([
        getPendingEvents({ entity: "rubber_bills", ownerUserId: profile.id, locationId }),
        getPendingEvents({ entity: "income_expense", ownerUserId: profile.id, locationId }),
      ]);
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      if (rubberQueue.length + incomeQueue.length > 0) throw new Error("อุปกรณ์นี้ยังมีรายการเงินสดรอซิงก์หรือต้องแก้ไข กรุณาจัดการก่อนเริ่มนับ");
      const response = await authFetch("/api/lanflow/cash-counts/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId }) });
      const errorBody = !response.ok
        ? await response.clone().json().catch(() => null)
        : null;
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      const blockers = response.status === 409 ? parsePendingWorkApiBody(errorBody) : null;
      if (blockers) {
        showPendingWorkBlockedToast("ยังเริ่มตรวจนับเงินไม่ได้", blockers);
        return;
      }
      await assertApiResponse(response);
      const body = (await response.json()) as { session: CashCountSession };
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      setSession(body.session);
      setReceipt(null); resetForm();
    } catch (error) {
      if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) {
        toast.error(error instanceof Error ? error.message : "เริ่มตรวจนับไม่สำเร็จ");
      }
    } finally {
      mutationLockRef.current = false; if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) setWorking(false);
    }
  }

  async function submit() {
    if (!online || mutationLockRef.current || !session || secondsLeft <= 0) return; mutationLockRef.current = true;
    const requestId = ++mutationRequestIdRef.current;
    const locationId = selectedLocation.id;
    const sessionId = session.id;
    setWorking(true);
    setSubmitError(null);
    try {
      const actualCounts = Object.fromEntries(CASH_DENOMINATIONS.map((d) => [String(d), Number(values[d])]));
      if (bankBlocked) throw new Error("กรุณาถ่ายใหม่หรือยืนยันยอดบัญชีก่อนบันทึก");
      const form = new FormData(); form.set("sessionId", sessionId); form.set("actualCounts", JSON.stringify(actualCounts));
      for (const slot of banks) {
        if (!slot.value) throw new Error("กรุณาถ่ายรูปหรือเอาช่องบัญชีที่ว่างออก");
        form.append("image", slot.value.file); form.append("evidenceId", slot.value.evidenceId); form.append("confirmed", String(slot.value.confirmed));
      }
      const response = await authFetch("/api/lanflow/cash-counts", { method: "POST", body: form });
      const errorBody = !response.ok
        ? await response.clone().json().catch(() => null)
        : null;
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      const blockers = response.status === 409 ? parsePendingWorkApiBody(errorBody) : null;
      if (blockers) {
        showPendingWorkBlockedToast("ยังส่งผลตรวจนับไม่ได้", blockers);
        setConfirmMode(null);
        return;
      }
      await assertApiResponse(response);
      const body = await response.json() as CashCountReceipt;
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      setReceipt(body); setSession(null); setConfirmMode(null);
      await refreshHistory(false, "ส่งผลสำเร็จ");
    } catch (error) {
      if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) {
        setSubmitError(error instanceof Error ? error.message : "ส่งผลตรวจนับไม่สำเร็จ");
        setConfirmMode(null);
      }
    }
    finally {
      mutationLockRef.current = false; if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) setWorking(false);
    }
  }

  async function cancel() {
    if (!online || mutationLockRef.current || !session) return; mutationLockRef.current = true;
    const requestId = ++mutationRequestIdRef.current;
    const locationId = selectedLocation.id;
    const sessionId = session.id;
    setWorking(true);
    try {
      const response = await authFetch("/api/lanflow/cash-counts/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      await assertApiResponse(response);
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      setSession(null); setConfirmMode(null); resetForm(); toast.success("ยกเลิกช่วงตรวจนับแล้ว");
    } catch (error) {
      if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) {
        toast.error(error instanceof Error ? error.message : "ยกเลิกไม่สำเร็จ");
      }
    } finally {
      mutationLockRef.current = false; if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) setWorking(false);
    }
  }

  async function removeCount() {
    if (!online || mutationLockRef.current || !deleteTarget) return; mutationLockRef.current = true;
    const requestId = ++mutationRequestIdRef.current;
    const locationId = selectedLocation.id;
    const target = deleteTarget;
    setWorking(true);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/${target.id}?locationId=${encodeURIComponent(locationId)}`, { method: "DELETE" });
      await assertApiResponse(response);
      if (requestId !== mutationRequestIdRef.current || locationIdRef.current !== locationId) return;
      setHistory((current) => current.filter((item) => item.id !== target.id));
      setReceipt((current) => current?.id === target.id ? null : current);
      toast.success(`ลบชุด ${target.reportNo} แบบถาวรแล้ว`); setDeleteTarget(null); setConfirmMode(null);
      await refreshHistory(true, "ลบสำเร็จ");
    } catch (error) {
      if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) {
        toast.error(error instanceof Error ? error.message : "ลบชุดตรวจนับไม่สำเร็จ");
      }
    } finally {
      mutationLockRef.current = false; if (requestId === mutationRequestIdRef.current && locationIdRef.current === locationId) setWorking(false);
    }
  }

  return (
    <section className="space-y-4 tabular-nums">
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col items-start gap-3">
          <div><h2 className="text-balance text-xl font-bold text-ink">นับเงิน — {selectedLocation.name}</h2><p className="mt-1 text-pretty text-sm text-ink/65">เทียบรับ–จ่ายสุทธิสะสม ณ เริ่มนับ ระหว่างนับระบบหยุดการเคลื่อนไหวเงินของสาขา</p></div>
          <button type="button" onClick={() => void loadSession()} disabled={!online || loading || working} className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><RotateCw size={16} className={cn(loading && "animate-spin")} />รีเฟรช</button>
        </div>

        {loading ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-lg bg-mint/50" /><div className="h-20 animate-pulse rounded-lg bg-mint/50" /><div className="h-20 animate-pulse rounded-lg bg-mint/50" /></div>
        : receipt ? <CashCountReceiptPanel receipt={receipt} locationId={selectedLocation.id} locationName={selectedLocation.name} online={online} onBack={() => setReceipt(null)} />
        : !session ? <div className="mt-5 rounded-lg bg-mint/35 p-5 text-center"><Banknote className="mx-auto text-leaf" size={32} /><h3 className="mt-2 font-bold text-ink">พร้อมเริ่มตรวจนับเงินสด</h3><p className="mt-1 text-pretty text-sm text-ink/65">ระบบจะยึดเวลา server ตอนเริ่มและให้กรอกภายใน 30 นาที</p><button type="button" onClick={() => void start()} disabled={!online || working} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-md bg-leaf px-5 py-2.5 font-semibold text-white disabled:opacity-50">{working && <Loader2 size={16} className="animate-spin" />}เริ่มนับเงิน</button></div>
        : !session.isOwner ? <div className="mt-5 rounded-lg bg-amber/20 p-4 text-sm font-semibold text-ink">{session.startedByName} กำลังตรวจนับสาขานี้ · เหลือ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} นาที</div>
        : secondsLeft <= 0 ? <div className="mt-5 rounded-lg bg-clay/10 p-4"><h3 className="font-bold text-clay">ช่วงตรวจนับหมดเวลาแล้ว</h3><p className="mt-1 text-sm text-ink/70">ผลเดิมส่งไม่ได้ กรุณารีเฟรชและเริ่มรอบใหม่</p></div>
        : <div className="mt-5"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold text-ink">Cutoff {dateTime(session.cutoffAt)}</span><span className="rounded-md bg-amber/20 px-3 py-1 font-bold text-amber-900">เหลือ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} นาที</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{CASH_DENOMINATIONS.map((d) => <label key={d} className="rounded-lg border border-black/10 bg-field p-3"><span className="text-sm font-semibold text-ink">{d >= 20 ? "ธนบัตร" : "เหรียญ"} {d} บาท</span><div className="mt-2"><InlineNumber value={values[d]} integerOnly ariaLabel={`จำนวนเงินชนิด ${d} บาท`} onChange={(value) => { setSubmitError(null); setValues((current) => ({ ...current, [d]: value })); }} /></div></label>)}</div><BankBalanceList key={session.id} sessionId={session.id} slots={banks} onChange={setBanks} disabled={working} /><p className="mt-3 text-pretty text-sm">ยอดระบบ ณ เริ่มนับ {money(session.systemBalance)} บาท · ส่วนต่าง {money(actualTotal + bankTotal - session.systemBalance)} บาท</p><div className="mt-4 flex flex-col gap-3 rounded-lg bg-mint/45 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm text-ink/60">ยอดรวมที่กรอก</div><div className="text-2xl font-bold text-ink">{money(actualTotal + bankTotal)} บาท</div></div><div className="flex gap-2"><button type="button" onClick={() => setConfirmMode("cancel")} className="focus-ring inline-flex items-center gap-1 min-h-11 rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white"><X size={16} />ยกเลิก</button><button type="button" onClick={() => setConfirmMode("submit")} disabled={working || bankBlocked} className="focus-ring rounded-md bg-leaf px-5 py-2 font-semibold text-white disabled:opacity-50">ยืนยันและส่งผล</button></div></div>{submitError && <p role="alert" className="mt-2 text-pretty text-sm font-medium text-clay">{submitError}</p>}</div>}
      </div>

      {manager && (
        <>
        {historyWarning && (
          <div role="status" className="flex flex-col items-start gap-3 rounded-lg border border-amber/30 bg-amber/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 break-words text-pretty text-sm font-medium text-ink">{historyWarning.message}</p>
            <button type="button" onClick={() => void refreshHistory(historyWarning.includeDeletions)} disabled={!online || working || historyRefreshing} className="focus-ring shrink-0 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{historyRefreshing ? "กำลังโหลดประวัติ" : "โหลดประวัติใหม่"}</button>
          </div>
        )}
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
        {historyView === "current" ? <div className="space-y-3">
          <div className="rounded-xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-black/5 p-4">
            <div><h3 className="font-bold text-ink">ประวัติผลตรวจนับสาขานี้</h3><p className="text-sm text-ink/60">แสดงทีละสาขาตามตัวเลือกหลักของแอป</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-mint/50 text-left"><tr><th className="px-4 py-3">จัดการ</th><th className="px-4 py-3">ใบนับเงิน</th><th className="px-4 py-3">ผู้นับ</th><th className="px-4 py-3 text-right">ยอดรวม / ส่วนต่าง</th><th className="px-4 py-3">ผู้ตรวจสอบ</th></tr></thead>
              <tbody className="divide-y divide-black/5">
                {history.length === 0 && <tr><td colSpan={5} className="px-4 py-7 text-center text-ink/55">ยังไม่มีผลตรวจนับ</td></tr>}
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3"><div className="flex gap-1.5 whitespace-nowrap">
                      <button type="button" onClick={() => openDetail(item.id, item.reportNo)}
                        title="ดูรายละเอียด" aria-label="ดูรายละเอียด"
                        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-white"><Eye size={17} /></button>
                      {manager && (
                        <button type="button" onClick={() => { setDeleteTarget(item); setConfirmMode("delete"); }}
                          disabled={!online || working || historyRefreshing}
                          title="ลบชุดล่าสุด" aria-label="ลบชุดล่าสุด"
                          className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 font-semibold text-white disabled:opacity-50"><Trash2 size={16} />ลบ</button>
                      )}
                    </div></td>
                    <td className="px-4 py-3"><div className="font-semibold">{item.reportNo}</div><div className="text-xs">{dateTime(item.createdAt)}</div></td>
                    <td className="px-4 py-3">{item.createdByName}</td>
                    <td className="px-4 py-3 text-right">{money(item.countedTotal)} / {item.systemBalance == null ? "ไม่มีข้อมูลฐานเดิม" : money(item.differenceTotal ?? 0)}</td>
                    <td className="px-4 py-3">{item.checkedByName ?? "ยังไม่ตรวจสอบ"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          {historyHasMore && historyCursor && !historyLoading && (
            <div className="flex justify-center">
              <button type="button" onClick={() => void loadHistory(historyCursor, true).catch((error) => toast.error(error instanceof Error ? error.message : "โหลดประวัติเพิ่มไม่สำเร็จ"))} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดผลตรวจนับเพิ่ม</button>
            </div>
          )}
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
            <div className="flex justify-center"><button type="button" onClick={() => void loadDeletions(deletionsCursor, true).catch((error) => toast.error(error instanceof Error ? error.message : "โหลดประวัติการลบไม่สำเร็จ"))} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดประวัติเพิ่ม</button></div>
          )}
          </div>
        )}
        </>
      )}

      {manager && detailTarget && (
        <ModalShell
          title={`รายละเอียด ${detail?.reportNo ?? detailTarget.reportNo ?? "ผลตรวจนับ"}`}
          subtitle={detail ? dateTime(detail.cutoffAt) : undefined}
          onClose={closeDetail}
          size="wide"
          mobileFullScreen
          closeOnEscape
          nativeModal
        >
          {detailLoading ? (
            <div role="status" className="space-y-4" aria-label="กำลังโหลดรายละเอียดผลตรวจนับ">
              <p className="text-pretty text-sm font-medium text-ink/65">กำลังโหลดรายละเอียด...</p>
              <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((item) => <div key={item} className="h-20 rounded-lg bg-field" />)}
              </div>
              <div aria-hidden="true" className="grid grid-cols-3 gap-2 sm:grid-cols-9">
                {CASH_DENOMINATIONS.map((denomination) => <div key={denomination} className="h-20 rounded-md bg-field" />)}
              </div>
            </div>
          ) : detailError ? (
            <div role="alert" className="rounded-lg border border-clay/30 bg-clay/10 p-4">
              <p className="text-pretty text-sm font-medium text-clay">โหลดรายละเอียดไม่สำเร็จ: {detailError}</p>
              <button
                type="button"
                aria-label="ลองใหม่สำหรับรายละเอียดผลตรวจนับ"
                onClick={() => void loadDetail(detailTarget.id)}
                className="focus-ring mt-3 rounded-md bg-actionSecondary px-4 py-2 text-sm font-semibold text-white"
              >
                ลองใหม่
              </button>
            </div>
          ) : detail ? (
            <CashCountDetails detail={detail} online={online} onChecked={() => { void loadDetail(detail.id); void loadHistory(); }} />
          ) : null}
        </ModalShell>
      )}

      <ConfirmDialog open={confirmMode === "submit"} title="ยืนยันผลตรวจนับ" description={`จำนวนที่กรอกครบ 9 ชนิด รวม ${money(actualTotal + bankTotal)} บาท หลังส่งแล้วแก้ไขไม่ได้`} detail={<div className="mt-3 grid grid-cols-3 gap-2">{CASH_DENOMINATIONS.map((d) => <div key={d} className="rounded-md bg-field p-2 text-center text-sm"><div className="text-xs text-ink/50">฿{d}</div><div className="font-bold text-ink">{values[d]}</div></div>)}</div>} confirmLabel="ส่งผลตรวจนับ" busy={working} onCancel={() => setConfirmMode(null)} onConfirm={() => void submit()} />
      <ConfirmDialog open={confirmMode === "cancel"} title="ยกเลิกช่วงตรวจนับ" description="ค่าที่กรอกในหน้านี้จะหาย และต้องเริ่มช่วงตรวจนับใหม่" confirmLabel="ยกเลิกช่วงนี้" busy={working} onCancel={() => setConfirmMode(null)} onConfirm={() => void cancel()} />
      <ConfirmDialog open={confirmMode === "delete"} title="ลบใบนับเงิน" description={`${deleteTarget?.reportNo ?? "รายการนี้"} จะถูกลบจากรายการใช้งาน โดยไม่กระทบรายงาน ระบบเก็บประวัติการลบไว้`} confirmLabel="ลบใบนับเงิน" busy={working} onCancel={() => { setConfirmMode(null); setDeleteTarget(null); }} onConfirm={() => void removeCount()} />
    </section>
  );
}
