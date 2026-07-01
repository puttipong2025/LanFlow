import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  
  let targetUserId = result.auth.sub;
  const supabase = result.supabase;

  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId");
  
  if (requestedUserId && requestedUserId !== targetUserId) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", targetUserId).single();
    if (profile?.role === 'super_admin' || profile?.role === 'admin') {
      targetUserId = requestedUserId;
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  try {
    const now = new Date();
    // Start of month in local time (Asia/Bangkok), let's simplify to start of current month UTC for now, or just build the string
    // e.g. "2026-06-01T00:00:00+07:00"
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleString('sv').replace(' ', 'T') + '+07:00';
    
    // We need profile to get daily_wage
    const profilePromise = supabase.from("profiles").select("daily_wage").eq("id", targetUserId).single();
    const segmentsPromise = supabase.from("time_segments").select("start_time, end_time").eq("profile_id", targetUserId).not("end_time", "is", null).gte("start_time", startOfMonth);
    const approvedTxPromise = supabase.from("financial_transactions").select("amount, type").eq("profile_id", targetUserId).eq("status", "APPROVED").gte("created_at", startOfMonth).in("type", ["WITHDRAWAL_DEDUCTION", "DEBT_DEDUCTION", "SALARY"]);
    const activeDebtsPromise = supabase.from("financial_transactions").select("remaining_amount").eq("profile_id", targetUserId).in("type", ["DEBT", "WITHDRAWAL"]).eq("status", "APPROVED").gt("remaining_amount", 0);

    const [timeTracking, debts, leaveRequests, transactions, profileRes, segmentsRes, approvedTxRes, activeDebtsRes] = await Promise.all([
      supabase.from("time_segments").select("*").eq("profile_id", targetUserId).is("end_time", null).maybeSingle(),
      supabase.from("debts").select("*").eq("profile_id", targetUserId).gt("remaining_amount", 0),
      supabase.from("leave_requests").select("*, approver:profiles!leave_requests_approved_by_fkey(name)").eq("profile_id", targetUserId).order("created_at", { ascending: false }).limit(10),
      supabase.from("financial_transactions").select("*, approver:profiles!financial_transactions_approved_by_fkey(name)").eq("profile_id", targetUserId).order("created_at", { ascending: false }).limit(20),
      profilePromise,
      segmentsPromise,
      approvedTxPromise,
      activeDebtsPromise
    ]);

    let totalMs = 0;
    segmentsRes.data?.forEach((seg: any) => {
      totalMs += new Date(seg.end_time).getTime() - new Date(seg.start_time).getTime();
    });
    const totalDays = totalMs / (1000 * 60 * 60 * 8);
    const grossPay = totalDays * (profileRes.data?.daily_wage || 0);

    let usedThisMonth = 0;
    approvedTxRes.data?.forEach((tx: any) => {
      usedThisMonth += Number(tx.amount || 0);
    });

    let totalDebt = 0;
    debts.data?.forEach((d: any) => {
      totalDebt += Number(d.remaining_amount || 0);
    });
    activeDebtsRes.data?.forEach((d: any) => {
      totalDebt += Number(d.remaining_amount || 0);
    });

    // remainingBalance = grossPay - usedThisMonth
    const remainingBalance = grossPay - usedThisMonth;

    return NextResponse.json({
      timeTracking: { 
        status: timeTracking.data ? 'RUNNING' : 'PAUSED',
        start_time: timeTracking.data?.start_time || null
      },
      wageInfo: {
        totalDays,
        grossPay,
        remainingBalance,
        totalDebt
      },
      debts: debts.data || [],
      leaveRequests: leaveRequests.data || [],
      transactions: transactions.data || []
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  
  const userId = result.auth.sub;
  const supabase = result.supabase;
  const body = await request.json();

  try {
    if (body.action === 'REQUEST_LEAVE') {
      const { start_date, end_date, type } = body.payload;
      const { error } = await supabase.from('leave_requests').insert({
        profile_id: userId, start_date, end_date, type
      });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    
    if (body.action === 'REQUEST_WITHDRAWAL') {
      const { amount } = body.payload;
      if (typeof amount !== 'number' || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }
      
      const { error } = await supabase.from('financial_transactions').insert({
        profile_id: userId, type: 'WITHDRAWAL', amount
      });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (body.action === 'TOGGLE_TRACKING') {
      const { status } = body.payload;
      
      if (status === 'RUNNING') {
        const { data: active } = await supabase.from("time_segments").select("id").eq("profile_id", userId).is("end_time", null).maybeSingle();
        if (!active) {
          await supabase.from("time_segments").insert({ profile_id: userId, start_time: new Date().toISOString() });
          await supabase.from('time_tracking_audit_logs').insert({ admin_id: userId, action: 'SELF_TOGGLE_TRACKING', target_table: 'time_segments', record_id: userId, new_data: { status: 'RUNNING' }});
        }
      } else {
        await supabase.from("time_segments").update({ end_time: new Date().toISOString() }).eq("profile_id", userId).is("end_time", null);
        await supabase.from('time_tracking_audit_logs').insert({ admin_id: userId, action: 'SELF_TOGGLE_TRACKING', target_table: 'time_segments', record_id: userId, new_data: { status: 'PAUSED' }});
      }
      return NextResponse.json({ success: true });
    }

    if (body.action === 'CUTOFF_TRACKING') {
      const { cutoff_time } = body.payload;
      
      await supabase.from("time_segments").update({ end_time: cutoff_time }).eq("profile_id", userId).is("end_time", null);
      await supabase.from("time_segments").insert({ profile_id: userId, start_time: cutoff_time });
      
      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: userId, action: 'SELF_CUTOFF_TRACKING', target_table: 'time_segments',
        record_id: userId, new_data: { cutoff_time }, comment: 'Auto split at 15:00'
      });
      
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
