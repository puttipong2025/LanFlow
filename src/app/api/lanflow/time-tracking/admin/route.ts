import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { calculatePaidWorkDays } from "@/lib/time-tracking/pay";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function approvalRpcErrorStatus(message: string) {
  if (/Authentication required/i.test(message)) return 401;
  if (/Forbidden|access denied|Cannot approve/i.test(message)) return 403;
  if (/already been decided|REPORT_LOCKED/i.test(message)) return 409;
  return 400;
}

function approvalRpcErrorMessage(message: string) {
  const reportNo = message.match(/REPORT_LOCKED:([A-Z0-9-]+)/i)?.[1];
  if (reportNo) return `ล็อกโดยรายงาน ${reportNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
  if (/Authentication required/i.test(message)) return "กรุณาเข้าสู่ระบบใหม่";
  if (/Expense location.*access denied|New expense location access denied/i.test(message)) return "คุณไม่มีสิทธิ์ดูแลสาขาค่าใช้จ่ายที่เลือก";
  if (/Expense location is not valid/i.test(message)) return "รายการนี้ไม่ต้องเลือกสาขาค่าใช้จ่าย";
  if (/already been decided/i.test(message)) return "รายการนี้ถูกตัดสินแล้ว กรุณารีเฟรชข้อมูล";
  if (/Cannot approve your own slip/i.test(message)) return "ไม่สามารถอนุมัติสลิปของตนเองได้";
  if (/Forbidden|Cannot approve/i.test(message)) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  return "ไม่สามารถทำรายการได้ กรุณาลองใหม่";
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  // Verify Admin
  const { data: profile } = await result.supabase.from("profiles").select("role").eq("id", result.auth.sub).single();
  if (profile?.role !== 'super_admin' && profile?.role !== 'admin') {
     return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    let usersQuery = result.supabase.from("profiles").select(`
      id, name, phone, daily_wage, role, is_active,
      time_segments(id, start_time, end_time, report_lock_no)
    `);

    let txQuery = result.supabase.from("financial_transactions").select("id, profile_id, amount, created_at, type, description, due_date, profiles!inner!financial_transactions_profile_id_fkey(name, role)").eq("status", "PENDING");
    let leaveQuery = result.supabase.from("leave_requests").select("id, profile_id, start_date, end_date, type, created_at, profiles!inner!leave_requests_profile_id_fkey(name, role)").eq("status", "PENDING");
    let slipQuery = result.supabase.from("payroll_slips").select("id, profile_id, month, net_pay, created_at, profiles!inner!payroll_slips_profile_id_fkey(name, role)").eq("status", "PENDING");

    if (profile?.role === 'admin') {
      usersQuery = usersQuery.in('role', ['user', 'admin']);
      txQuery = txQuery.in('profiles.role', ['user', 'admin']);
      leaveQuery = leaveQuery.in('profiles.role', ['user', 'admin']);
      slipQuery = slipQuery.in('profiles.role', ['user', 'admin']);
    }

    const { data: users, error: usersError } = await usersQuery;
    if (usersError) console.error("usersError", usersError);

    const visibleUsers = profile?.role === 'admin'
      ? (users || []).filter((user: any) => user.role === 'user' || user.id === result.auth.sub)
      : (users || []);

    let usersWithDebtTotals = visibleUsers;
    const userIds = visibleUsers.map((user: any) => user.id);
    if (userIds.length > 0) {
      const { data: activeDebts, error: debtError } = await result.supabase
        .from("financial_transactions")
        .select("profile_id, remaining_amount")
        .in("profile_id", userIds)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .eq("status", "APPROVED")
        .gt("remaining_amount", 0);

      if (debtError) {
        console.error("debtError", debtError);
      } else {
        const debtTotals = new Map<string, number>();
        activeDebts?.forEach((debt: any) => {
          debtTotals.set(
            debt.profile_id,
            (debtTotals.get(debt.profile_id) || 0) + Number(debt.remaining_amount || 0)
          );
        });
        usersWithDebtTotals = usersWithDebtTotals.map((user: any) => ({
          ...user,
          debt_remaining_amount: debtTotals.get(user.id) || 0
        }));
      }
    }

    const { data: pendingTransactions, error: txError } = await txQuery;
    if (txError) console.error("txError", txError);

    const { data: pendingLeaves, error: leaveError } = await leaveQuery;
    if (leaveError) console.error("leaveError", leaveError);

    const { data: pendingSlips, error: slipError } = await slipQuery;
    if (slipError) console.error("slipError", slipError);

    const canAdminSeeRecord = (record: any) => {
      if (profile?.role !== 'admin') return true;
      return record.profile_id === result.auth.sub || record.profiles?.role === 'user';
    };

    const { data: admins } = await result.supabase.from("profiles").select("id, name").in("role", ["admin", "super_admin"]);

    return NextResponse.json({
      users: usersWithDebtTotals,
      pendingTransactions: (pendingTransactions || []).filter(canAdminSeeRecord),
      pendingLeaves: (pendingLeaves || []).filter(canAdminSeeRecord),
      pendingSlips: (pendingSlips || []).filter(canAdminSeeRecord),
      admins: admins || []
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const adminId = result.auth.sub;
  const supabase = result.supabase;
  const body = await request.json();

  const { data: profile } = await supabase.from("profiles").select("role, name").eq("id", adminId).single();
  const adminRole = profile?.role;
  if (adminRole !== 'super_admin' && adminRole !== 'admin') {
     return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  async function canEditUser(targetUserId: string) {
    if (adminRole === 'super_admin') return true;
    if (targetUserId === adminId) return true;
    const { data: target } = await supabase.from('profiles').select('role').eq('id', targetUserId).single();
    if (!target) return false;
    return target.role === 'user';
  }

  async function canApproveUser(targetUserId: string) {
    if (adminRole === 'super_admin') return true;
    const { data: target } = await supabase.from('profiles').select('role').eq('id', targetUserId).single();
    if (!target) return false;
    return target.role === 'user';
  }

  try {
    if (body.action === 'GET_AUDIT_LOGS') {
      const { admin_user_id, target_user_id, action_filter } = body.payload;
      let query = supabase.from('time_tracking_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (admin_user_id) query = query.eq('admin_id', admin_user_id);
      if (target_user_id) query = query.eq('record_id', target_user_id);
      if (action_filter) query = query.eq('action', action_filter);

      const { data: logs } = await query;
      return NextResponse.json({ logs: logs || [] });
    }

    if (body.action === 'TOGGLE_TRACKING') {
      const { user_id, status } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      if (status === 'RUNNING') {
        const { data: active } = await supabase.from("time_segments").select("id").eq("profile_id", user_id).is("end_time", null).maybeSingle();
        if (!active) {
          await supabase.from("time_segments").insert({ profile_id: user_id, start_time: new Date().toISOString() });
          await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'TOGGLE_TRACKING', target_table: 'time_segments', record_id: user_id, new_data: { status: 'RUNNING' }});
        }
      } else {
        await supabase.from("time_segments").update({ end_time: new Date().toISOString() }).eq("profile_id", user_id).is("end_time", null);
        await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'TOGGLE_TRACKING', target_table: 'time_segments', record_id: user_id, new_data: { status: 'PAUSED' }});
      }
      return NextResponse.json({ success: true });
    }

    if (body.action === 'CUTOFF_TRACKING') {
      const { user_id, cutoff_time } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      await supabase.from("time_segments").update({ end_time: cutoff_time }).eq("profile_id", user_id).is("end_time", null);
      await supabase.from("time_segments").insert({ profile_id: user_id, start_time: cutoff_time });

      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: adminId, action: 'CUTOFF_TRACKING', target_table: 'time_segments',
        record_id: user_id, new_data: { cutoff_time }, comment: 'Auto split at 15:00'
      });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'CREATE_DEBT') {
      const { user_id, amount, due_date, description } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (typeof amount !== 'number' || amount <= 0 || !due_date || !description) {
        return NextResponse.json({ error: "Invalid debt data" }, { status: 400 });
      }

      const adminComment = `สร้างหนี้สินโดย: ${profile?.name || 'Admin'}`;
      const { data: debt, error } = await supabase.from('financial_transactions').insert({
        profile_id: user_id, type: 'DEBT', amount, due_date, description, admin_comment: adminComment
      }).select('id').single();
      if (error) {
         console.error("CREATE_DEBT error", error);
         return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'CREATE_DEBT', target_table: 'financial_transactions', record_id: debt.id, new_data: { amount, due_date, description }, comment: adminComment });

      return NextResponse.json({ success: true });
    }
    if (body.action === 'DELETE_TRANSACTION') {
      const { transaction_id } = body.payload;
      const { data, error } = await supabase.rpc('delete_time_tracking_source_permanently', {
        p_source_type: 'transaction',
        p_source_id: transaction_id,
      });
      if (error) return NextResponse.json({ error: approvalRpcErrorMessage(error.message) }, { status: approvalRpcErrorStatus(error.message) });
      return NextResponse.json({ success: true, deleted: true, result: data });
    }


    if (body.action === 'APPROVE_TRANSACTION') {
      const { transaction_id, status, admin_comment, expense_location_id } = body.payload;
      if (!isUuid(transaction_id) || !['APPROVED', 'REJECTED'].includes(status) || (expense_location_id && !isUuid(expense_location_id))) {
        return NextResponse.json({ error: 'ข้อมูลการอนุมัติไม่ถูกต้อง' }, { status: 400 });
      }
      const { data, error } = await supabase.rpc('decide_time_tracking_approval', {
        p_source_type: 'transaction',
        p_source_id: transaction_id,
        p_decision: status,
        p_comment: admin_comment || null,
        p_expense_location_id: expense_location_id || null,
      });
      if (error) return NextResponse.json({ error: approvalRpcErrorMessage(error.message) }, { status: approvalRpcErrorStatus(error.message) });
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === 'APPROVE_LEAVE') {
      const { request_id, status, admin_comment } = body.payload;
      const { data: oldData } = await supabase.from('leave_requests').select('*').eq("id", request_id).single();
      if (!oldData || !(await canApproveUser(oldData.profile_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await supabase.from('leave_requests').update({ status, admin_comment, approved_by: adminId }).eq("id", request_id);
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'APPROVE_LEAVE', target_table: 'leave_requests', record_id: request_id, old_data: oldData, new_data: { status }, comment: admin_comment });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'CHANGE_EXPENSE_LOCATION') {
      const { source_type, source_id, expense_location_id, admin_comment } = body.payload;
      if (!['transaction', 'payroll_slip'].includes(source_type) || !isUuid(source_id) || !isUuid(expense_location_id)) {
        return NextResponse.json({ error: 'ข้อมูลการเปลี่ยนสาขาไม่ถูกต้อง' }, { status: 400 });
      }
      const { data, error } = await supabase.rpc('change_time_tracking_expense_location', {
        p_source_type: source_type,
        p_source_id: source_id,
        p_expense_location_id: expense_location_id,
        p_comment: admin_comment || null,
      });
      if (error) return NextResponse.json({ error: approvalRpcErrorMessage(error.message) }, { status: approvalRpcErrorStatus(error.message) });
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === 'UPDATE_WAGE') {
      const { user_id, daily_wage } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      // Use service_role to bypass RLS since profiles often restricts updates to self
      const { createClient } = await import('@supabase/supabase-js');
      const serviceSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data: oldData } = await serviceSupabase.from('profiles').select('daily_wage').eq('id', user_id).single();
      await serviceSupabase.from('profiles').update({ daily_wage }).eq('id', user_id);

      await serviceSupabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'UPDATE_WAGE', target_table: 'profiles', record_id: user_id, old_data: oldData, new_data: { daily_wage } });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'GET_LOCKED_DATES') {
      const { user_id } = body.payload;
      const lockedDates: Record<string, string> = {};

      // Find all months that have DEBT_DEDUCTION transactions for this user
      const { data: deductions } = await supabase.from('financial_transactions')
        .select('created_at')
        .eq('profile_id', user_id)
        .eq('type', 'DEBT_DEDUCTION')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });



      if (deductions && deductions.length > 0) {
        // For each deduction, find the date it was created
        const deductionDatesByMonth = new Map<string, string>(); // monthKey -> latest deduction date
        for (const d of deductions) {
          const dt = new Date(d.created_at);
          const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          const dateStr = dt.toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).split(' ')[0];
          if (!deductionDatesByMonth.has(monthKey) || dateStr > deductionDatesByMonth.get(monthKey)!) {
            deductionDatesByMonth.set(monthKey, dateStr);
          }
        }

        // Get all time segments for this user to know which dates actually have work recorded
        const { data: segments } = await supabase.from('time_segments')
          .select('start_time')
          .eq('profile_id', user_id)
          .not('end_time', 'is', null);

        const activeDates = new Set<string>();
        if (segments) {
          for (const s of segments) {
            const dt = new Date(s.start_time);
            activeDates.add(dt.toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).split(' ')[0]);
          }
        }

        // For each month, only lock dates that actually have a time segment on or before the deduction date
        for (const [monthKey, latestDate] of deductionDatesByMonth) {
          const [year, month] = monthKey.split('-').map(Number);
          const latestDay = parseInt(latestDate.split('-')[2]);
          for (let day = 1; day <= latestDay; day++) {
            const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (activeDates.has(dStr)) {
              lockedDates[dStr] = 'DEBT';
            }
          }
        }
      }

      // Lock all dates in months that have a payroll slip
      const { data: slips } = await supabase.from('payroll_slips').select('month').eq('profile_id', user_id);
      if (slips && slips.length > 0) {
        for (const slip of slips) {
          const [year, month] = slip.month.split('-').map(Number);
          const daysInMonth = new Date(year, month, 0).getDate();
          for (let day = 1; day <= daysInMonth; day++) {
            const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            lockedDates[dStr] = 'SLIP';
          }
        }
      }

      const { data: reportedSegments } = await supabase
        .from('time_segments')
        .select('start_time, report_lock_no')
        .eq('profile_id', user_id)
        .not('end_time', 'is', null);
      for (const segment of reportedSegments ?? []) {
        if (!segment.report_lock_no) continue;
        const date = new Date(segment.start_time)
          .toLocaleString('sv', { timeZone: 'Asia/Bangkok' })
          .split(' ')[0];
        lockedDates[date] = `REPORT:${segment.report_lock_no}`;
      }

      return NextResponse.json({ lockedDates });
    }

    if (body.action === 'ADD_BULK_SEGMENTS') {
      const { user_id, selections, full_snapshot, admin_comment } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const bulkOldData: any[] = [];
      const bulkNewData: any[] = [];
      const affectedDates: string[] = [];

      for (const sel of selections) {
        const { date, work_type } = sel;
        affectedDates.push(date);
        const startOfDay = new Date(`${date}T00:00:00+07:00`).toISOString();
        const endOfDay = new Date(`${date}T23:59:59+07:00`).toISOString();

        const { data: existing } = await supabase.from('time_segments').select('*')
          .eq('profile_id', user_id)
          .gte('start_time', startOfDay)
          .lte('start_time', endOfDay);

        if (existing && existing.length > 0) {
          bulkOldData.push(...existing);
          await supabase.from('time_segments').delete()
            .eq('profile_id', user_id)
            .gte('start_time', startOfDay)
            .lte('start_time', endOfDay);
        }

        if (work_type !== 'NONE') {
          const startTime = new Date(`${date}T08:00:00+07:00`).toISOString();
          const endTime = new Date(`${date}T${work_type === 'HALF_DAY' ? '12:00:00' : '16:00:00'}+07:00`).toISOString();

          const { data: inserted } = await supabase.from('time_segments').insert({ profile_id: user_id, start_time: startTime, end_time: endTime }).select().single();
          if (inserted) bulkNewData.push(inserted);
        }
      }

      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: adminId, action: 'BULK_UPDATE_SEGMENTS', target_table: 'time_segments',
        record_id: user_id, old_data: { segments: bulkOldData, dates: affectedDates }, new_data: { segments: bulkNewData, selections, full_snapshot },
        comment: admin_comment
      });

      return NextResponse.json({ success: true });
    }



    if (body.action === 'ADMIN_REQUEST_LEAVE') {
      const { user_id, start_date, end_date, type } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const adminComment = `ยื่นแทนโดย Admin: ${profile?.name || 'Admin'}`;
      await supabase.from('leave_requests').insert({ profile_id: user_id, start_date, end_date, type, admin_comment: adminComment });
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'ADMIN_REQUEST_LEAVE', target_table: 'leave_requests', record_id: user_id, new_data: { start_date, end_date, type }, comment: adminComment });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'ADMIN_REQUEST_WITHDRAWAL') {
      const { user_id, amount } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const adminComment = `ยื่นแทนโดย Admin: ${profile?.name || 'Admin'}`;
      const { data: withdrawal, error } = await supabase.from('financial_transactions').insert({
        profile_id: user_id, type: 'WITHDRAWAL', amount, admin_comment: adminComment,
      }).select('id').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'ADMIN_REQUEST_WITHDRAWAL', target_table: 'financial_transactions', record_id: withdrawal.id, new_data: { amount }, comment: adminComment });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'CREATE_PAYROLL_SLIP') {
      const { user_id, month } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const { data: existingSlip } = await supabase.from('payroll_slips')
        .select('id')
        .eq('profile_id', user_id)
        .eq('month', month)
        .maybeSingle();

      if (existingSlip) {
        return NextResponse.json({ error: "Payroll slip already exists for this month" }, { status: 409 });
      }

      const startDate = new Date(`${month}-01T00:00:00+07:00`).toISOString();
      let nextMonthDate = new Date(`${month}-01T00:00:00+07:00`);
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      const endDate = nextMonthDate.toISOString();

      // Get Profile
      const { data: profile } = await supabase.from('profiles').select('daily_wage').eq('id', user_id).single();
      const daily_wage = profile?.daily_wage || 0;

      // Get Segments
      const { data: segments } = await supabase.from('time_segments').select('*')
        .eq('profile_id', user_id)
        .not('end_time', 'is', null)
        .gte('start_time', startDate)
        .lt('start_time', endDate);

      const total_days = calculatePaidWorkDays(segments);
      const gross_pay = total_days * daily_wage;

      // Get Transactions
      const { data: txs } = await supabase.from('financial_transactions').select('*')
        .eq('profile_id', user_id)
        .gte('created_at', startDate)
        .lt('created_at', endDate);

      let total_deductions = 0;
      txs?.forEach(tx => {
        if (tx.status === 'APPROVED' && (tx.type === 'WITHDRAWAL_DEDUCTION' || tx.type === 'DEBT_DEDUCTION')) {
          total_deductions += tx.amount;
        }
      });
      const net_pay = gross_pay - total_deductions;

      // Snapshot Data
      const slip_data = {
        segments: segments || [],
        transactions: txs || [],
        lockedAt: new Date().toISOString()
      };

      const { data: slip, error } = await supabase.from('payroll_slips').insert({
        profile_id: user_id,
        month,
        gross_pay,
        total_deductions,
        net_pay,
        total_days,
        daily_wage,
        slip_data,
        status: 'PENDING',
        created_by: adminId
      }).select().single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'CREATE_PAYROLL_SLIP', target_table: 'payroll_slips', record_id: slip.id, new_data: slip, comment: `สร้างสลิปเดือน ${month}` });
      return NextResponse.json({ success: true, slip });
    }

    if (body.action === 'LIST_PAYROLL_SLIPS') {
      const { user_id } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const { data: slips } = await supabase.from('payroll_slips').select('*, report_lock_no, approver:profiles!payroll_slips_approved_by_fkey(name)').eq('profile_id', user_id).order('month', { ascending: false });
      return NextResponse.json({ slips: slips || [] });
    }

    if (body.action === 'DELETE_PAYROLL_SLIP') {
      const { slip_id } = body.payload;
      const { data, error } = await supabase.rpc('delete_time_tracking_source_permanently', {
        p_source_type: 'payroll_slip',
        p_source_id: slip_id,
      });
      if (error) return NextResponse.json({ error: approvalRpcErrorMessage(error.message) }, { status: approvalRpcErrorStatus(error.message) });
      return NextResponse.json({ success: true, deleted: true, result: data });
    }

    if (body.action === 'APPROVE_PAYROLL_SLIP') {
      const { slip_id, status, admin_comment, expense_location_id } = body.payload;
      if (!isUuid(slip_id) || !['APPROVED', 'REJECTED'].includes(status) || (expense_location_id && !isUuid(expense_location_id))) {
        return NextResponse.json({ error: 'ข้อมูลการอนุมัติไม่ถูกต้อง' }, { status: 400 });
      }
      const { data, error } = await supabase.rpc('decide_time_tracking_approval', {
        p_source_type: 'payroll_slip',
        p_source_id: slip_id,
        p_decision: status,
        p_comment: admin_comment || null,
        p_expense_location_id: expense_location_id || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: approvalRpcErrorStatus(error.message) });
      return NextResponse.json({ success: true, result: data });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
