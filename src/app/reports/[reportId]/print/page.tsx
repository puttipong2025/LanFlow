"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import type { ReportDetails } from "@/types/reports";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function quantity(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function thaiDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function thaiDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function EmptyRow({ columns }: { columns: number }) {
  return <tr><td colSpan={columns} className="empty">ไม่มีรายการ</td></tr>;
}

export default function ReportPrintPage() {
  const params = useParams<{ reportId: string }>();
  const [details, setDetails] = useState<ReportDetails | null>(null);
  const [error, setError] = useState("");
  const printed = useRef(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const response = await authFetch(`/api/lanflow/reports/${params.reportId}`, {
          cache: "no-store",
        });
        await assertApiResponse(response);
        const body = await response.json() as ReportDetails;
        if (!ignore) setDetails(body);
      } catch (caught) {
        if (!ignore) setError(caught instanceof Error ? caught.message : "โหลดรายงานไม่สำเร็จ");
      }
    }
    void load();
    return () => { ignore = true; };
  }, [params.reportId]);

  useEffect(() => {
    if (!details || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [details]);

  const totals = useMemo(() => {
    if (!details) return null;
    const income = details.incomeExpense.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0);
    const expense = details.incomeExpense.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);
    return {
      rubberWeight: details.rubberBills.reduce((sum, row) => sum + row.weight, 0),
      rubberDeduction: details.rubberBills.reduce((sum, row) => sum + row.deduction, 0),
      rubberNet: details.rubberBills.reduce((sum, row) => sum + row.net, 0),
      rubberCash: details.rubberBills.reduce((sum, row) => sum + row.cash, 0),
      rubberTransfer: details.rubberBills.reduce((sum, row) => sum + row.transfer, 0),
      ocrNet: details.ocrTickets.reduce((sum, row) => sum + row.weightNet, 0),
      ocrRemaining: details.ocrTickets.reduce((sum, row) => sum + row.weightRemaining, 0),
      ocrAmount: details.ocrTickets.reduce((sum, row) => sum + row.amount, 0),
      income,
      expense,
      balance: income - expense,
      stockQuantity: details.stock.reduce((sum, row) => sum + row.quantity, 0),
      stockAmount: details.stock.reduce((sum, row) => sum + row.amount, 0),
      payrollAmount: details.timePayroll.reduce((sum, row) => sum + (row.amount ?? 0), 0),
      workHours: details.timePayroll.filter((row) => row.category === "เวลาทำงาน").reduce((sum, row) => sum + (row.quantity ?? 0), 0),
      leaveDays: details.timePayroll.filter((row) => row.category === "ลา").reduce((sum, row) => sum + (row.quantity ?? 0), 0),
      transferAmount: details.bankTransfers.reduce((sum, row) => sum + row.amount, 0),
      slipAmount: details.bankTransfers.reduce((sum, row) => sum + row.slipAmount, 0),
      fee: details.bankTransfers.reduce((sum, row) => sum + row.fee, 0),
      branchPaid: details.bankTransfers.reduce((sum, row) => sum + row.branchPaid, 0),
    };
  }, [details]);

  if (error) return <main className="p-8 text-center text-red-700">{error}</main>;
  if (!details || !totals) return <main className="p-8 text-center">กำลังโหลดรายงาน...</main>;

  return (
    <main className="report-page">
      <style jsx global>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .report-page { padding: 0 !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          h2 { break-after: avoid; page-break-after: avoid; }
        }
        .report-page { margin: 0 auto; max-width: 1500px; padding: 20px; color: #14251c; font-family: Arial, "Noto Sans Thai", sans-serif; }
        .report-header { border-bottom: 2px solid #14251c; padding-bottom: 10px; }
        .report-header h1 { margin: 0; font-size: 22px; }
        .report-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 16px; margin-top: 8px; font-size: 12px; }
        .report-section { margin-top: 16px; }
        .report-section h2 { margin: 0 0 6px; font-size: 16px; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 10px; }
        .report-table th, .report-table td { border: 1px solid #6c786f; padding: 4px 5px; vertical-align: top; }
        .report-table th { background: #dcebdd; text-align: left; }
        .report-table .num { text-align: right; white-space: nowrap; }
        .report-table tfoot td { background: #f1f5f2; font-weight: 700; }
        .empty { padding: 12px !important; text-align: center; color: #647067; }
        .summary-grid { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
        .deleted { color: #a12626; font-weight: 700; }
      `}</style>

      <button
        type="button"
        onClick={() => window.print()}
        className="no-print fixed right-5 top-5 inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white shadow"
      >
        <Printer size={18} />
        พิมพ์อีกครั้ง
      </button>

      <header className="report-header">
        <h1>ชุดรายงาน LanFlow</h1>
        <div className="report-meta">
          <div><strong>เลขรายงาน:</strong> {details.report.reportNo}</div>
          <div><strong>สาขา:</strong> {details.report.locationName}</div>
          <div><strong>Cutoff:</strong> {thaiDateTime(details.report.cutoffAt)}</div>
          <div><strong>ผู้สร้าง:</strong> {details.report.createdByName}</div>
          <div><strong>สร้างเมื่อ:</strong> {thaiDateTime(details.report.createdAt)}</div>
          <div><strong>จำนวน source:</strong> {details.report.itemCount.toLocaleString("th-TH")}</div>
          <div><strong>สถานะ:</strong> <span className={details.report.status === "deleted" ? "deleted" : ""}>{details.report.status === "active" ? "ใช้งาน" : "ลบแล้ว (สำเนา)"}</span></div>
        </div>
      </header>

      <section className="report-section">
        <h2>1. บิลยาง</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>ลูกค้า</th><th>ประเภท</th><th className="num">น้ำหนัก</th><th className="num">ยอดหัก</th><th className="num">ยอดสุทธิ</th><th className="num">เงินสด</th><th className="num">โอน</th></tr></thead>
          <tbody>
            {details.rubberBills.length === 0 && <EmptyRow columns={9} />}
            {details.rubberBills.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.customer}</td><td>{row.billType}</td><td className="num">{quantity(row.weight)}</td><td className="num">{money(row.deduction)}</td><td className="num">{money(row.net)}</td><td className="num">{money(row.cash)}</td><td className="num">{money(row.transfer)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={4}>รวม</td><td className="num">{quantity(totals.rubberWeight)}</td><td className="num">{money(totals.rubberDeduction)}</td><td className="num">{money(totals.rubberNet)}</td><td className="num">{money(totals.rubberCash)}</td><td className="num">{money(totals.rubberTransfer)}</td></tr></tfoot>
        </table>
      </section>

      <section className="report-section">
        <h2>2. อ่านใบชั่ง</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>ลูกค้า</th><th>ทะเบียน</th><th className="num">ชั่งเข้า</th><th className="num">ชั่งออก</th><th className="num">สุทธิ</th><th className="num">หัก</th><th className="num">คงเหลือ</th><th className="num">ยอดเงิน</th></tr></thead>
          <tbody>
            {details.ocrTickets.length === 0 && <EmptyRow columns={10} />}
            {details.ocrTickets.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.customer}</td><td>{row.licensePlate}</td><td className="num">{quantity(row.weightIn)}</td><td className="num">{quantity(row.weightOut)}</td><td className="num">{quantity(row.weightNet)}</td><td className="num">{quantity(row.weightDeducted)}</td><td className="num">{quantity(row.weightRemaining)}</td><td className="num">{money(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={6}>รวม</td><td className="num">{quantity(totals.ocrNet)}</td><td></td><td className="num">{quantity(totals.ocrRemaining)}</td><td className="num">{money(totals.ocrAmount)}</td></tr></tfoot>
        </table>
      </section>

      <section className="report-section">
        <h2>3. รับ–จ่ายรวม</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>ประเภท</th><th>รายการ</th><th className="num">จำนวนเงิน</th></tr></thead>
          <tbody>
            {details.incomeExpense.length === 0 && <EmptyRow columns={5} />}
            {details.incomeExpense.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.type === "income" ? "รายรับ" : "รายจ่าย"}</td><td>{row.title}</td><td className="num">{money(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={5}><div className="summary-grid"><span>รายรับรวม {money(totals.income)}</span><span>รายจ่ายรวม {money(totals.expense)}</span><span>ยอดคงเหลือสุทธิ {money(totals.balance)}</span></div></td></tr></tfoot>
        </table>
      </section>

      <section className="report-section">
        <h2>4. สต็อกสินค้า</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>สินค้า</th><th>ประเภท</th><th className="num">จำนวนเคลื่อนไหว</th><th className="num">ยอดเงินประกอบ</th></tr></thead>
          <tbody>
            {details.stock.length === 0 && <EmptyRow columns={6} />}
            {details.stock.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.product}</td><td>{row.type}</td><td className="num">{quantity(row.quantity)}</td><td className="num">{money(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={4}>รวมการเคลื่อนไหว</td><td className="num">{quantity(totals.stockQuantity)}</td><td className="num">{money(totals.stockAmount)}</td></tr></tfoot>
        </table>
        <div className="mt-2 text-right text-xs font-semibold">
          ยอดคงเหลือ ณ cutoff: {details.stockBalances.length === 0
            ? "ไม่มีรายการ"
            : details.stockBalances.map((row) => `${row.product} ${quantity(row.quantity)}`).join(" · ")}
        </div>
      </section>

      <section className="report-section">
        <h2>5. เวลาและเงินเดือน</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>ประเภท</th><th>พนักงาน</th><th>รายละเอียด</th><th className="num">ชั่วโมง/วัน</th><th className="num">จำนวนเงิน</th></tr></thead>
          <tbody>
            {details.timePayroll.length === 0 && <EmptyRow columns={7} />}
            {details.timePayroll.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.category}</td><td>{row.employee}</td><td>{row.detail}</td><td className="num">{row.quantity === null ? "-" : quantity(row.quantity)}</td><td className="num">{row.amount === null ? "-" : money(row.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={7}><div className="summary-grid"><span>เวลาทำงาน {quantity(totals.workHours)} ชม.</span><span>วันลา {quantity(totals.leaveDays)} วัน</span><span>ธุรกรรม/เงินเดือน {money(totals.payrollAmount)}</span></div></td></tr></tfoot>
        </table>
      </section>

      <section className="report-section">
        <h2>6. โอนเงิน (ธนาคารเท่านั้น)</h2>
        <table className="report-table">
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>ทิศทาง</th><th>คู่รายการ</th><th>สถานะ</th><th className="num">ยอดที่ต้องจ่าย</th><th className="num">ยอดสลิป</th><th className="num">ค่าธรรมเนียม</th><th className="num">สาขาจ่าย</th></tr></thead>
          <tbody>
            {details.bankTransfers.length === 0 && <EmptyRow columns={9} />}
            {details.bankTransfers.map((row, index) => <tr key={`${row.number}-${index}`}><td>{thaiDate(row.date)}</td><td>{row.number}</td><td>{row.direction === "out" ? "ออก" : "เข้า"}</td><td>{row.party}</td><td>{row.status}</td><td className="num">{money(row.amount)}</td><td className="num">{money(row.slipAmount)}</td><td className="num">{money(row.fee)}</td><td className="num">{money(row.branchPaid)}</td></tr>)}
          </tbody>
          <tfoot><tr><td colSpan={5}>รวม</td><td className="num">{money(totals.transferAmount)}</td><td className="num">{money(totals.slipAmount)}</td><td className="num">{money(totals.fee)}</td><td className="num">{money(totals.branchPaid)}</td></tr></tfoot>
        </table>
      </section>
    </main>
  );
}
