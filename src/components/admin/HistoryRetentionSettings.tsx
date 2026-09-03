"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { authFetch } from "@/lib/auth-fetch";
import appSwal from "@/lib/swal";
import type { HistoryRetentionOverview } from "@/types/history-retention";

const GROUP_LABELS: Record<string, { label: string; detail: string }> = {
  dashboard_money_events: { label: "ประวัติรายการเงินล่าสุด", detail: "เหตุการณ์เพิ่ม แก้ไข และลบบน Dashboard" },
  time_tracking_audit_logs: { label: "ประวัติเวลาและเงินเดือน", detail: "Audit การจัดการเวลา การลา ค่าแรง และช่วงทำงาน" },
  admin_account_audit_logs: { label: "ประวัติจัดการบัญชี", detail: "รายการที่สำเร็จ ล้มเหลว หรือไม่ทราบผล; pending ยังไม่ถูกลบ" },
  income_expense_approval_requests: { label: "คำขออนุมัติรับ–จ่าย", detail: "เฉพาะคำขอที่อนุมัติ ปฏิเสธ หรือยกเลิกแล้ว" },
  cash_transfer_delete_requests: { label: "คำขอลบรายการโยกเงิน", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  rubber_bill_approval_requests: { label: "คำขออนุมัติบิลยาง", detail: "เฉพาะคำขอที่สิ้นสุดแล้ว ไม่ลบบิลจริง" },
  stock_entry_approval_requests: { label: "คำขออนุมัติรายการสต็อก", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  stock_product_approval_requests: { label: "คำขออนุมัติสินค้า", detail: "เฉพาะคำขอที่ตัดสินแล้ว" },
  scheduler_run_history: { label: "ประวัติการทำงานอัตโนมัติ", detail: "ผลรันของ Scheduler โดยไม่ลบตัวงานหรือกำหนดเวลา" },
  cleanup_run_history: { label: "ประวัติการล้างข้อมูล", detail: "ผลการล้างแต่ละรอบ ไม่รวมหลักฐานการเปลี่ยนค่า" },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })
    .format(new Date(`${value}T00:00:00+07:00`));
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({})) as HistoryRetentionOverview & { error?: string };
  if (!response.ok) throw new Error(data.error || "โหลดการตั้งค่าไม่สำเร็จ");
  return data;
}

export function HistoryRetentionSettings() {
  const [overview, setOverview] = useState<HistoryRetentionOverview | null>(null);
  const [preview, setPreview] = useState<HistoryRetentionOverview | null>(null);
  const [days, setDays] = useState(15);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", { cache: "no-store" }));
      setOverview(data);
      setDays(data.currentDays);
      setPreview(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดการตั้งค่าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function requestPreview() {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError("จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", retentionDays: days }),
      }));
      setPreview(data);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "คำนวณผลกระทบไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!overview || !preview || preview.requestedDays !== days) return;
    const decreasing = days < overview.currentDays;
    const confirmation = await appSwal.fire({
      title: decreasing ? `ลดระยะเก็บเหลือ ${days} วัน?` : `เพิ่มระยะเก็บเป็น ${days} วัน?`,
      html: decreasing
        ? `ข้อมูล <strong>${preview.totalEligible.toLocaleString("th-TH")}</strong> รายการอยู่นอกช่วงและจะถูกลบถาวรเป็นรอบย่อย`
        : "ข้อมูลที่เคยถูกลบไปแล้วจะไม่กลับคืน ระบบจะเริ่มเก็บข้อมูลใหม่ตามช่วงที่ยาวขึ้น",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "ยืนยันเปลี่ยนค่า",
      cancelButtonText: "ยกเลิก",
    });
    if (!confirmation.isConfirmed) return;
    setWorking(true);
    setError(null);
    try {
      const data = await readResponse(await authFetch("/api/lanflow/admin/history-retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          retentionDays: days,
          expectedUpdatedAt: overview.updatedAt,
        }),
      }));
      setOverview(data);
      setDays(data.currentDays);
      setPreview(null);
      if (data.cleanup?.status === "failed") {
        toast.warning("บันทึกค่าแล้ว แต่การล้างรอบแรกไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ");
      } else {
        toast.success("บันทึกระยะเก็บประวัติแล้ว");
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "บันทึกการตั้งค่าไม่สำเร็จ";
      setError(message);
      if (message.includes("โหลดข้อมูลล่าสุด")) void load();
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <section className="rounded-md border border-black/10 bg-white p-6 shadow-panel" role="status">กำลังโหลดการตั้งค่าประวัติ...</section>;
  if (!overview) return <section className="rounded-md border border-rose-200 bg-white p-6 shadow-panel"><p className="text-rose-700">{error ?? "โหลดการตั้งค่าไม่สำเร็จ"}</p><button type="button" onClick={() => void load()} className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-black/15 px-3 font-semibold"><RefreshCw size={16} />ลองใหม่</button></section>;

  const shown = preview ?? overview;
  const dirty = days !== overview.currentDays;
  return <div className="space-y-5">
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="flex items-center gap-2 text-lg font-bold text-ink"><Database size={19} />ระยะเก็บประวัติชั่วคราว</h3><p className="mt-1 text-pretty text-sm text-ink/60">ใช้ค่าเดียวทั้งระบบ นับเป็นวันปฏิทิน Asia/Bangkok</p></div>
        <span className="rounded-md bg-field px-3 py-1.5 text-sm font-semibold">ปัจจุบัน {overview.currentDays} วัน</span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-3">
          <label className="grid gap-1 text-sm font-semibold" htmlFor="history-retention-days">จำนวนวันที่เก็บ
            <input id="history-retention-days" type="number" inputMode="numeric" min={1} max={365} value={days} disabled={working}
              onChange={(event) => { setDays(Number(event.target.value)); setPreview(null); setError(null); }}
              aria-describedby="history-retention-hint" className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field" />
          </label>
          <p id="history-retention-hint" className="text-pretty text-sm text-ink/60">กำหนดได้ 1–365 วัน เช่น 15 วันหมายถึงวันนี้และ 14 วันก่อนหน้า</p>
          {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working || !dirty} onClick={() => void requestPreview()} className="focus-ring h-10 rounded-md border border-river/30 px-3 text-sm font-bold text-river disabled:cursor-not-allowed disabled:opacity-50">{working ? "กำลังตรวจ..." : "ตรวจผลกระทบ"}</button>
            <button type="button" disabled={working || !dirty || !preview || preview.requestedDays !== days} onClick={() => void save()} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">บันทึกค่า</button>
          </div>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-start gap-2 font-semibold text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={17} />การลบประวัติเป็นการลบถาวร</p>
          <p className="mt-2 text-pretty text-sm text-amber-900/80">เมื่อลดวัน รายการนอกช่วงจะหยุดแสดงทันทีและทยอยลบเป็นรอบย่อย การเพิ่มวันภายหลังไม่สามารถกู้รายการที่ลบแล้วกลับมาได้</p>
        </div>
      </div>
    </section>

    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-bold text-ink">ข้อมูลที่ได้รับผลกระทบ</h3><p className="text-sm text-ink/60">ช่วงใหม่เริ่มวันที่ {formatDate(shown.cutoffDate)} · เข้าเกณฑ์ลบ {shown.totalEligible.toLocaleString("th-TH")} รายการ</p></div>{preview && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">ตัวอย่างก่อนบันทึก</span>}</div>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead><tr className="border-b border-black/10 text-ink/60"><th className="p-3">กลุ่มข้อมูล</th><th className="p-3 text-right">เข้าเกณฑ์ลบ</th><th className="p-3">วันที่เก่าสุด</th></tr></thead><tbody className="divide-y divide-black/5">{shown.groups.map((group) => { const copy = GROUP_LABELS[group.key] ?? { label: group.key, detail: "ประวัติชั่วคราว" }; return <tr key={group.key}><td className="p-3"><p className="font-semibold text-ink">{copy.label}</p><p className="text-pretty text-xs text-ink/55">{copy.detail}</p></td><td className="p-3 text-right font-semibold tabular-nums">{group.eligibleCount.toLocaleString("th-TH")}</td><td className="p-3 tabular-nums">{formatDate(group.oldestDate)}</td></tr>; })}</tbody></table></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4"><h3 className="flex items-center gap-2 font-bold text-emerald-900"><ShieldCheck size={18} />ไม่ลบและไม่กระทบ</h3><ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-emerald-950/80"><li>บิลยางและรับ–จ่ายสถานะ <code>deleted</code> รวมเลขเอกสารและ revision</li><li>Dashboard ยอดรับ–จ่ายสะสม ยอดซื้อยาง และยอดสต็อก</li><li>ข้อมูลธุรกิจ รายงาน Payroll Slip และ relation lock</li><li>หลักฐานลบ RPT, REX, Cash Count และ WEX แบบถาวร</li><li>Auth audit, Realtime message และ platform log ที่ผู้ให้บริการจัดการ</li></ul></div>
      <div className="rounded-md border border-black/10 bg-white p-4"><h3 className="flex items-center gap-2 font-bold text-ink"><CheckCircle2 size={18} className="text-leaf" />สถานะงานอัตโนมัติ</h3>{overview.lastCleanup ? <div className="mt-3 space-y-1 text-sm"><p>รอบล่าสุด: <strong>{overview.lastCleanup.status === "succeeded" ? "สำเร็จ" : overview.lastCleanup.status === "failed" ? "ไม่สำเร็จ" : "กำลังทำงาน"}</strong></p><p className="text-ink/60">ยังมีรายการรอล้าง: {overview.lastCleanup.hasMore ? "มี — ระบบจะทำต่อรอบถัดไป" : "ไม่มี"}</p>{overview.lastCleanup.errorMessage && <p className="text-rose-700">{overview.lastCleanup.errorMessage}</p>}</div> : <p className="mt-3 text-sm text-ink/60">ยังไม่มีประวัติการล้าง ระบบทำงานทุกวันเวลา 00:10 น.</p>}</div>
    </section>
  </div>;
}
