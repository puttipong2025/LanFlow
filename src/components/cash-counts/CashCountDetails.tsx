"use client";
import { useState } from "react";
import { CASH_DENOMINATIONS, type CashCountDetail } from "@/types/cash-counts";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { useSharePdf } from "@/hooks/useSharePdf";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { cashCountDifference } from "@/lib/cash-count-pdf";
import { CashCountBankImage } from "./CashCountBankImage";

export function CashCountDetails({ detail, online, onChecked, canCheck = true }: { detail: CashCountDetail; online: boolean; onChecked: () => void; canCheck?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const share = useSharePdf();
  const money = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2 });
  const button = "focus-ring min-h-11 rounded-md px-3 text-sm font-semibold text-white disabled:opacity-50";
  async function check() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/${detail.id}`, { method: "PATCH" });
      await assertApiResponse(response); onChecked();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ตรวจสอบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function pdf() {
    setError(null);
    try {
      await share.sharePdfFile(async (signal) => {
        const { createCashCountPdf } = await import("@/lib/cash-count-pdf");
        return { file: await createCashCountPdf(detail, signal), title: "ใบนับเงิน" };
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "สร้าง PDF ไม่สำเร็จ"); }
  }
  return <div className="space-y-4 tabular-nums">
    <div className="grid grid-cols-2 gap-3">{[
      ["เงินสด", money(detail.actualTotal)], ["เงินในบัญชี", money(detail.accountBalance)],
      ["ยอดรวม", money(detail.countedTotal)], ["ยอดระบบ ณ เริ่มนับ", detail.systemBalance == null ? "ไม่มีข้อมูลฐานเดิม" : money(detail.systemBalance)],
    ].map(([label, value]) => <div key={label} className="rounded-lg bg-field p-3"><p className="text-pretty text-sm text-ink/65">{label}</p><p className="text-pretty text-lg font-bold">{value}</p></div>)}</div>
    <p className="text-pretty font-bold">{cashCountDifference(detail.systemBalance == null ? null : detail.differenceTotal)}</p>
    <div className="grid grid-cols-3 gap-2">{CASH_DENOMINATIONS.map((d) => <div key={d} className="rounded-md border p-2 text-center"><div>{d} บาท</div><div className="font-bold">{detail.actualCounts[String(d)] ?? 0}</div></div>)}</div>
    <p className="text-pretty text-sm">ผู้นับ: {detail.createdByName} · ผู้ตรวจ: {detail.checkedByName ?? "ยังไม่ตรวจสอบ"}</p>
    {detail.bankAccounts?.map((account) => <section key={account.id} className="space-y-2 rounded-md border border-black/10 p-3">
      <p className="text-pretty text-sm font-semibold">บัญชี{account.position} = {money(account.amount)} บาท</p>
      {canCheck && <CashCountBankImage countId={detail.id} position={account.position} />}
    </section>)}
    {!detail.bankAccounts?.length && detail.hasBankAccount && canCheck && <CashCountBankImage countId={detail.id} />}
    <div className="flex flex-wrap gap-2">{canCheck && !detail.checkedAt && <button type="button" className={`${button} bg-leaf`} disabled={!online || busy} onClick={() => void check()}>ยืนยันตรวจสอบ</button>}
      <button type="button" className={`${button} bg-river`} disabled={!online || share.busy} onClick={() => void pdf()}>พิมพ์ / PDF 80 มม.</button></div>
    {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
    <SharePdfWaitingModal open={share.waiting} description="กำลังสร้างใบนับเงิน" onCancel={share.cancel} />
  </div>;
}
