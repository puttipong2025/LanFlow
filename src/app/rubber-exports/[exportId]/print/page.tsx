"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import type { RubberExportDetails } from "@/types/rubber-exports";

function number(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export default function RubberExportPrintPage() {
  const params = useParams<{ exportId: string }>();
  const [details, setDetails] = useState<RubberExportDetails | null>(null);
  const [error, setError] = useState("");
  const printed = useRef(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const response = await authFetch(`/api/lanflow/rubber-exports/${params.exportId}`, {
          cache: "no-store",
        });
        await assertApiResponse(response);
        const body = await response.json() as RubberExportDetails;
        if (body.status === "draft") throw new Error("พิมพ์ได้เฉพาะรายการตรวจสอบแล้วหรือลบแล้ว");
        if (!ignore) setDetails(body);
      } catch (caught) {
        if (!ignore) setError(caught instanceof Error ? caught.message : "โหลดเอกสารไม่สำเร็จ");
      }
    }
    void load();
    return () => { ignore = true; };
  }, [params.exportId]);

  useEffect(() => {
    if (!details || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [details]);

  if (error) return <main className="p-8 text-center text-red-700">{error}</main>;
  if (!details) return <main className="p-8 text-center">กำลังโหลดเอกสาร...</main>;

  return (
    <main className="export-print">
      <style jsx global>{`
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .export-print { padding: 0 !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
        .export-print { position: relative; margin: 0 auto; max-width: 1400px; padding: 24px; color: #14251c; font-family: Arial, "Noto Sans Thai", sans-serif; }
        .export-print header { border-bottom: 2px solid #14251c; padding-bottom: 10px; }
        .export-print h1 { margin: 0; font-size: 24px; }
        .export-print .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 16px; margin-top: 10px; font-size: 12px; }
        .export-print .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 16px 0; }
        .export-print .summary div { border: 1px solid #9aa79d; padding: 8px; }
        .export-print table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .export-print th, .export-print td { border: 1px solid #6c786f; padding: 5px; vertical-align: top; }
        .export-print th { background: #dcebdd; text-align: left; }
        .export-print .num { text-align: right; white-space: nowrap; }
        .export-print .audit { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; font-size: 12px; }
        .export-print .watermark { position: fixed; inset: 42% 0 auto; z-index: 10; text-align: center; font-size: 90px; font-weight: 800; color: rgba(170, 30, 30, .15); transform: rotate(-16deg); pointer-events: none; }
      `}</style>

      {details.status === "deleted" && <div className="watermark">ลบแล้ว</div>}
      <button type="button" onClick={() => window.print()} className="no-print fixed right-5 top-5 inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white shadow">
        <Printer size={18} /> พิมพ์อีกครั้ง
      </button>

      <header>
        <h1>รายการส่งออกยาง</h1>
        <div className="meta">
          <div><strong>เลขที่:</strong> {details.exportNo}</div>
          <div><strong>สาขา:</strong> {details.locationName}</div>
          <div><strong>สถานะ:</strong> {details.status === "verified" ? "ตรวจสอบแล้ว" : "ลบแล้ว"}</div>
          <div><strong>Cutoff:</strong> {dateTime(details.cutoffAt)}</div>
          {details.status === "deleted" && <div><strong>ลบจากสถานะ:</strong> {details.previousStatus === "verified" ? "ตรวจสอบแล้ว" : "ฉบับร่าง"}</div>}
        </div>
      </header>

      <section className="summary">
        <div><strong>น้ำหนักสุทธิหลังหักรวม</strong><br />{number(details.originalWeightTotal)} กก.</div>
        <div><strong>ยอดจ่ายจริงรวม</strong><br />฿{number(details.paidTotal)}</div>
        <div><strong>ราคาเฉลี่ย</strong><br />฿{number(details.averagePrice)}/กก.</div>
        <div><strong>น้ำหนักปัจจุบัน</strong><br />{number(details.currentWeight)} กก.</div>
        <div><strong>น้ำหนักหาย</strong><br />{number(details.weightLossPercent)}%</div>
        <div><strong>ค่าทำงานต่อกิโลกรัม</strong><br />฿{number(details.workRate)}</div>
        <div><strong>ค่าดำเนินการอื่น</strong><br />฿{number(details.otherOperatingCost)}</div>
        <div><strong>ยอดค่าทำงานรวม</strong><br />฿{number(details.workTotal)}</div>
      </section>

      <table>
        <thead>
          <tr>
            <th>วันที่บิล</th>
            <th>เลขบิล</th>
            <th>ลูกค้า</th>
            <th>เวลาพร้อมออกรายงาน</th>
            <th className="num">น้ำหนักสุทธิหลังหัก</th>
            <th className="num">ยอดจ่ายจริง</th>
          </tr>
        </thead>
        <tbody>
          {details.items.map((item) => (
            <tr key={item.id}>
              <td>{item.billDate}</td>
              <td>{item.billNo}</td>
              <td>{item.customerName}</td>
              <td>{dateTime(item.eligibilityAt)}</td>
              <td className="num">{number(item.netWeight)}</td>
              <td className="num">{number(item.paidAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="audit">
        <div><strong>ผู้สร้าง:</strong> {details.createdByName}<br /><strong>สร้างเมื่อ:</strong> {dateTime(details.createdAt)}</div>
        <div><strong>ผู้ตรวจสอบ:</strong> {details.verifiedByName || "—"}<br /><strong>ตรวจสอบเมื่อ:</strong> {dateTime(details.verifiedAt)}</div>
        <div><strong>ผู้ลบ:</strong> {details.deletedByName || "—"}<br /><strong>ลบเมื่อ:</strong> {dateTime(details.deletedAt)}</div>
      </section>
    </main>
  );
}

