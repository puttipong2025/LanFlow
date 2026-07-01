import { requireAuth } from "@/lib/server/auth";
import { formatCurrency } from "@/lib/format";
import { notFound } from "next/navigation";


export const dynamic = "force-dynamic";

export default async function PayrollSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const result = await requireAuth();
  if (!result.ok) return <div>Unauthorized</div>;

  const { supabase, auth } = result;

  // Fetch the slip
  const { id } = await params;
  const { data: slip } = await supabase
    .from('payroll_slips')
    .select('*, profiles!payroll_slips_profile_id_fkey(name, role)')
    .eq('id', id)
    .single();

  if (!slip) {
    return notFound();
  }

  // Fetch current user
  const { data: currentUser } = await supabase.from('profiles').select('role').eq('id', auth.sub).single();

  // Security: only owner or admin can view
  if (slip.profile_id !== auth.sub && currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
    return <div>Unauthorized</div>;
  }

  const { slip_data } = slip;
  const transactions = slip_data.transactions || [];
  const segments = slip_data.segments || [];

  // Reconstruct initialDates from segments
  const initialDates: Record<string, string> = {};
  segments.forEach((s: any) => {
    if (!s.end_time) return;
    const start = new Date(s.start_time);
    const end = new Date(s.end_time);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const dStr = start.toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).split(' ')[0];
    initialDates[dStr] = hours <= 4 ? 'HALF_DAY' : 'FULL_DAY';
  });

  const [year, month] = slip.month.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const firstDay = new Date(year, month - 1, 1).getDay();

  const approvedTransactions = transactions.filter((t: any) => t.status === 'APPROVED' && t.type !== 'DEBT' && t.type !== 'WITHDRAWAL');
  const approvedDebts = transactions.filter((t: any) => t.status === 'APPROVED' && (t.type === 'DEBT' || t.type === 'WITHDRAWAL'));

  return (
    <div className="min-h-screen bg-sand p-8 flex flex-col items-center print:bg-white print:p-0">
      
      <div className="print:hidden w-full max-w-[210mm] flex justify-end mb-4">
        <button type="button" className="px-4 py-2 bg-ink text-white rounded font-bold shadow-md hover:bg-ink/80 transition-colors">พิมพ์สลิป</button>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelector('button').onclick = function() { window.print(); };
      `}} />

      <div className="bg-white w-full max-w-[210mm] min-h-[297mm] p-10 shadow-lg print:shadow-none text-ink relative mx-auto box-border">
        
        <div className="text-center border-b-2 border-ink pb-6 mb-6">
          <h1 className="text-3xl font-bold uppercase tracking-widest">สลิปเงินเดือน / Payroll Slip</h1>
          <h2 className="text-xl font-semibold mt-2 text-ink/80">เดือน {slip.month}</h2>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
          <div>
            <p className="mb-2"><span className="font-semibold text-ink/60">ชื่อพนักงาน:</span> <span className="font-bold text-lg">{slip.profiles?.name}</span></p>
            <p className="mb-2"><span className="font-semibold text-ink/60">รหัสอ้างอิง:</span> {slip.id}</p>
          </div>
          <div className="text-right">
            <p className="mb-2"><span className="font-semibold text-ink/60">วันที่ออกสลิป:</span> {new Date(slip.created_at).toLocaleDateString('th-TH')}</p>
            <p className="mb-2"><span className="font-semibold text-ink/60">สถานะ:</span> <span className="font-bold bg-ink/10 px-2 py-1 rounded">{slip.status}</span></p>
          </div>
        </div>

        {/* SUMMARY SECTION */}
        <div className="bg-ink/5 rounded-lg p-6 mb-8 border border-ink/10">
           <h3 className="text-lg font-bold mb-4 border-b border-ink/10 pb-2">สรุปรายได้และรายการหัก (Summary)</h3>
           <div className="flex justify-between items-center mb-2">
             <span>จำนวนวันทำงานรวม:</span>
             <span className="font-semibold">{slip.total_days.toFixed(2)} วัน</span>
           </div>
           <div className="flex justify-between items-center mb-2">
             <span>ค่าแรงต่อวัน:</span>
             <span className="font-semibold">{formatCurrency(slip.daily_wage)}</span>
           </div>
           <div className="flex justify-between items-center mb-2">
             <span>ค่าแรงรวม (Gross Pay):</span>
             <span className="font-bold text-leaf text-lg">{formatCurrency(slip.gross_pay)}</span>
           </div>
           <div className="flex justify-between items-center mb-4 pb-4 border-b border-ink/10">
             <span>ยอดหัก/เบิก/ใช้หนี้ รวม:</span>
             <span className="font-bold text-clay text-lg">-{formatCurrency(slip.total_deductions)}</span>
           </div>
           <div className="flex justify-between items-center">
             <span className="font-bold text-xl">ยอดสุทธิ (Net Pay):</span>
             <span className={`font-bold text-2xl ${slip.net_pay < 0 ? 'text-clay' : 'text-river'}`}>
               {formatCurrency(slip.net_pay)}
             </span>
           </div>
        </div>

        {/* CALENDAR SECTION */}
        <div className="mb-8">
           <h3 className="text-lg font-bold mb-4 border-b border-ink/10 pb-2">บันทึกเวลาทำงาน (Attendance)</h3>
           <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs mb-2">
            <div>อา.</div><div>จ.</div><div>อ.</div><div>พ.</div><div>พฤ.</div><div>ศ.</div><div>ส.</div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="h-10"></div>
            ))}
            {days.map(d => {
              const wt = initialDates[d];
              return (
                <div 
                  key={d} 
                  className={`h-10 rounded-md border flex items-center justify-center text-xs font-bold
                    ${wt === 'FULL_DAY' ? 'bg-leaf text-white border-transparent' : 
                      wt === 'HALF_DAY' ? 'bg-leaf/50 text-white border-transparent' : 
                      'bg-white border-ink/20 text-ink/30'}`
                  }
                >
                  {parseInt(d.split('-')[2])}
                </div>
              );
            })}
          </div>
        </div>

        {/* TRANSACTIONS SECTION */}
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <h3 className="font-bold mb-3 border-b border-ink/10 pb-2">ประวัติหักเงิน</h3>
            {approvedTransactions.length === 0 ? (
              <p className="text-ink/50 text-xs">ไม่มีรายการ</p>
            ) : (
              <ul className="space-y-2">
                {approvedTransactions.map((t: any) => (
                  <li key={t.id} className="flex justify-between border-b border-ink/5 pb-1">
                    <span>{t.type === 'DEBT_DEDUCTION' ? 'หักหนี้อัตโนมัติ' : t.type === 'WITHDRAWAL' ? 'เบิกเงิน' : t.type} {t.description && `(${t.description})`}</span>
                    <span className="font-semibold">{formatCurrency(t.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-bold mb-3 border-b border-ink/10 pb-2">ประวัติสร้างหนี้สิน/เบิกเงิน</h3>
            {approvedDebts.length === 0 ? (
              <p className="text-ink/50 text-xs">ไม่มีรายการ</p>
            ) : (
              <ul className="space-y-2">
                {approvedDebts.map((t: any) => (
                  <li key={t.id} className="flex justify-between border-b border-ink/5 pb-1">
                    <span>{t.type === 'WITHDRAWAL' ? 'เบิกเงิน' : 'สร้างหนี้สิน'} {t.description && `(${t.description})`}</span>
                    <span className={`font-semibold ${t.type === 'WITHDRAWAL' ? 'text-amber' : 'text-clay'}`}>{formatCurrency(t.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        
        <div className="absolute bottom-10 left-10 right-10 flex justify-between text-sm font-bold text-ink/40">
          <span>LanFlow Time Tracking System</span>
          <span>เอกสารนี้ถูกสร้างโดยอัตโนมัติจากระบบ</span>
        </div>

      </div>
    </div>
  );
}
