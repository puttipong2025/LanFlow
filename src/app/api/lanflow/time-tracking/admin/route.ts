import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

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
      time_segments(id, start_time, end_time),
      debts(remaining_amount)
    `);

    let txQuery = result.supabase.from("financial_transactions").select("id, profile_id, amount, created_at, type, description, due_date, profiles!inner(name, role)").eq("status", "PENDING");
    let leaveQuery = result.supabase.from("leave_requests").select("id, profile_id, start_date, end_date, type, created_at, profiles!inner(name, role)").eq("status", "PENDING");
    let slipQuery = result.supabase.from("payroll_slips").select("id, profile_id, month, net_pay, created_at, profiles!inner!payroll_slips_profile_id_fkey(name, role)").eq("status", "PENDING");

    if (profile?.role === 'admin') {
      usersQuery = usersQuery.eq('role', 'user');
      txQuery = txQuery.eq('profiles.role', 'user');
      leaveQuery = leaveQuery.eq('profiles.role', 'user');
      slipQuery = slipQuery.eq('profiles.role', 'user');
    }

    const { data: users, error: usersError } = await usersQuery;
    if (usersError) console.error("usersError", usersError);
    
    const { data: pendingTransactions } = await txQuery;
    const { data: pendingLeaves } = await leaveQuery;
    const { data: pendingSlips } = await slipQuery;
    
    const { data: admins } = await result.supabase.from("profiles").select("id, name").in("role", ["admin", "super_admin"]);

    return NextResponse.json({ 
      users: users || [],
      pendingTransactions: pendingTransactions || [],
      pendingLeaves: pendingLeaves || [],
      pendingSlips: pendingSlips || [],
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

    if (body.action === 'UPSERT_DEBT') {
      const { user_id, amount, admin_comment } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      
      if (typeof amount !== 'number' || !admin_comment) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const { data: existingDebt } = await supabase.from('debts').select('*').eq('profile_id', user_id).maybeSingle();
      let recordId;
      if (existingDebt) {
        const { data } = await supabase.from('debts').update({ total_amount: existingDebt.total_amount + amount, remaining_amount: existingDebt.remaining_amount + amount }).eq('id', existingDebt.id).select().single();
        recordId = data?.id;
      } else {
        const { data } = await supabase.from('debts').insert({ profile_id: user_id, total_amount: amount, remaining_amount: amount, installment_amount: 0 }).select().single();
        recordId = data?.id;
      }

      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: adminId,
        action: 'UPSERT_DEBT',
        target_table: 'debts',
        record_id: recordId,
        new_data: { amount_added: amount },
        comment: admin_comment
      });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'CREATE_DEBT') {
      const { user_id, amount, due_date, description } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      
      const adminComment = `สร้างหนี้สินโดย: ${profile?.name || 'Admin'}`;
      const { error } = await supabase.from('financial_transactions').insert({ 
        profile_id: user_id, type: 'DEBT', amount, due_date, description, admin_comment: adminComment 
      });
      if (error) {
         console.error("CREATE_DEBT error", error);
         return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'CREATE_DEBT', target_table: 'financial_transactions', record_id: user_id, new_data: { amount, due_date, description }, comment: adminComment });
      
      return NextResponse.json({ success: true });
    }
    if (body.action === 'DELETE_TRANSACTION') {
      const { transaction_id } = body.payload;
      if (adminRole !== 'super_admin') {
        return NextResponse.json({ error: "เฉพาะ Super Admin เท่านั้นที่สามารถลบรายการได้" }, { status: 403 });
      }

      const { data: tx } = await supabase.from('financial_transactions').select('*').eq('id', transaction_id).single();
      if (!tx) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });

      // Only allow DEBT or WITHDRAWAL
      if (tx.type !== 'DEBT' && tx.type !== 'WITHDRAWAL') {
        return NextResponse.json({ error: "ไม่สามารถลบรายการประเภทนี้ได้" }, { status: 400 });
      }

      // Check if slip exists in the same month
      const createdDate = new Date(tx.created_at);
      const monthStr = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;
      const { data: slips } = await supabase.from('payroll_slips')
        .select('id')
        .eq('profile_id', tx.profile_id)
        .eq('month', monthStr)
        .limit(1);

      if (slips && slips.length > 0) {
        return NextResponse.json({ error: "ไม่สามารถลบได้เนื่องจากมีการออกสลิปเงินเดือนของเดือนนี้ไปแล้ว โปรดลบสลิปเงินเดือนก่อน" }, { status: 400 });
      }

      // Delete linked child transactions (e.g. DEBT_DEDUCTION) to prevent FK violation
      if (tx.type === 'DEBT' || tx.type === 'WITHDRAWAL') {
         await supabase.from('financial_transactions').delete().eq('parent_debt_id', transaction_id);
      }

      const { error } = await supabase.from('financial_transactions').delete().eq('id', transaction_id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      
      await supabase.from('time_tracking_audit_logs').insert({ 
        admin_id: adminId, action: 'DELETE_TRANSACTION', target_table: 'financial_transactions', 
        record_id: transaction_id, old_data: tx, comment: `ลบรายการ ${tx.type} จำนวน ${tx.amount}`
      });

      return NextResponse.json({ success: true });
    }


    if (body.action === 'APPROVE_TRANSACTION') {
      const { transaction_id, status, admin_comment } = body.payload;
      const { data: tx } = await supabase.from('financial_transactions').select('*').eq("id", transaction_id).single();
      if (!tx || !(await canEditUser(tx.profile_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      
      if (tx.type === 'DEBT' && adminRole !== 'super_admin') {
         return NextResponse.json({ error: "Only super_admin can approve debts" }, { status: 403 });
      }

      const updates: any = { status, admin_comment, approved_by: adminId };
      if (status === 'APPROVED' && (tx.type === 'DEBT' || tx.type === 'WITHDRAWAL') && tx.status !== 'APPROVED') {
         updates.remaining_amount = tx.amount;
      }
      
      await supabase.from('financial_transactions').update(updates).eq("id", transaction_id);
      
      if (status === 'APPROVED' && tx && tx.type === 'WITHDRAWAL' && tx.status !== 'APPROVED') {
         const { data: existingDebt } = await supabase.from('debts').select('*').eq('profile_id', tx.profile_id).maybeSingle();
         if (existingDebt) {
           await supabase.from('debts').update({ total_amount: existingDebt.total_amount + tx.amount, remaining_amount: existingDebt.remaining_amount + tx.amount }).eq('id', existingDebt.id);
         } else {
           await supabase.from('debts').insert({ profile_id: tx.profile_id, total_amount: tx.amount, remaining_amount: tx.amount, installment_amount: 0 });
         }
      }

      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: adminId, action: 'APPROVE_TRANSACTION', target_table: 'financial_transactions',
        record_id: transaction_id, old_data: { status: tx?.status }, new_data: { status }, comment: admin_comment
      });

      return NextResponse.json({ success: true });
    }

    if (body.action === 'APPROVE_LEAVE') {
      const { request_id, status, admin_comment } = body.payload;
      const { data: oldData } = await supabase.from('leave_requests').select('*').eq("id", request_id).single();
      if (!oldData || !(await canEditUser(oldData.profile_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await supabase.from('leave_requests').update({ status, admin_comment, approved_by: adminId }).eq("id", request_id);
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'APPROVE_LEAVE', target_table: 'leave_requests', record_id: request_id, old_data: oldData, new_data: { status }, comment: admin_comment });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'CALCULATE_PAYROLL') {
      const { user_id, month } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      // month is "YYYY-MM". We append timezone offset +07:00 to match local boundary.
      const startDate = new Date(`${month}-01T00:00:00+07:00`).toISOString();
      let nextMonthDate = new Date(`${month}-01T00:00:00+07:00`);
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      const endDate = nextMonthDate.toISOString();

      const { data: userSegments } = await supabase.from('time_segments').select('start_time, end_time')
        .eq('profile_id', user_id)
        .not('end_time', 'is', null)
        .gte('start_time', startDate)
        .lt('start_time', endDate);

      const { data: profile } = await supabase.from('profiles').select('daily_wage').eq('id', user_id).single();
      
      let totalMs = 0;
      userSegments?.forEach(seg => {
        totalMs += new Date(seg.end_time).getTime() - new Date(seg.start_time).getTime();
      });
      // Use 8 hours (28,800,000 ms) as 1 working day instead of 24 hours
      const totalDays = totalMs / (1000 * 60 * 60 * 8);
      const grossPay = totalDays * (profile?.daily_wage || 0);

      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'CALCULATE_PAYROLL', target_table: 'profiles', record_id: user_id, new_data: { totalDays, grossPay, month } });

      return NextResponse.json({ success: true, totalDays, grossPay });
    }

    if (body.action === 'CONFIRM_PAYROLL') {
      const { user_id, deduct_amount, gross_pay, net_pay, admin_comment } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      
      const { data: tx } = await supabase.from('financial_transactions').insert({
        profile_id: user_id, type: 'SALARY', amount: net_pay, status: 'APPROVED', admin_comment
      }).select().single();

      let oldDebt = null;
      let actualDeduct = deduct_amount;

      if (deduct_amount > 0) {
        const { data: existingDebt } = await supabase.from('debts').select('*').eq('profile_id', user_id).maybeSingle();
        if (existingDebt) {
           oldDebt = existingDebt;
           actualDeduct = Math.min(deduct_amount, existingDebt.remaining_amount);
           await supabase.from('debts').update({ 
             remaining_amount: existingDebt.remaining_amount - actualDeduct 
           }).eq('id', existingDebt.id);
        }
      }

      await supabase.from('time_tracking_audit_logs').insert({
        admin_id: adminId, action: 'CONFIRM_PAYROLL', target_table: 'financial_transactions',
        record_id: tx?.id || user_id, old_data: oldDebt ? { remaining_debt: oldDebt.remaining_amount } : null,
        new_data: { gross_pay, deduct_amount: actualDeduct, net_pay }, comment: admin_comment
      });

      return NextResponse.json({ success: true });
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

    if (body.action === 'ADD_MANUAL_SEGMENT') {
      const { user_id, start_time, end_time, admin_comment } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await supabase.from('time_segments').insert({ profile_id: user_id, start_time, end_time });
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'ADD_MANUAL_SEGMENT', target_table: 'time_segments', record_id: user_id, new_data: { start_time, end_time }, comment: admin_comment });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'ADD_MANUAL_LEAVE') {
      const { user_id, date, type, admin_comment } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await supabase.from('leave_requests').insert({ profile_id: user_id, start_date: date, end_date: date, type, status: 'APPROVED', admin_comment });
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'ADD_MANUAL_LEAVE', target_table: 'leave_requests', record_id: user_id, new_data: { date, type }, comment: admin_comment });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'GET_LOCKED_DATES') {
      const { user_id } = body.payload;
      const lockedDates: Record<string, 'SLIP' | 'DEBT'> = {};
      
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
      await supabase.from('financial_transactions').insert({ profile_id: user_id, type: 'WITHDRAWAL', amount, admin_comment: adminComment });
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'ADMIN_REQUEST_WITHDRAWAL', target_table: 'financial_transactions', record_id: user_id, new_data: { amount }, comment: adminComment });
      
      return NextResponse.json({ success: true });
    }

    if (body.action === 'CREATE_PAYROLL_SLIP') {
      const { user_id, month } = body.payload;
      if (!(await canEditUser(user_id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      
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

      let totalMs = 0;
      segments?.forEach(seg => {
        totalMs += new Date(seg.end_time).getTime() - new Date(seg.start_time).getTime();
      });
      const total_days = totalMs / (1000 * 60 * 60 * 8);
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
      const { data: slips } = await supabase.from('payroll_slips').select('*, approver:profiles!payroll_slips_approved_by_fkey(name)').eq('profile_id', user_id).order('month', { ascending: false });
      return NextResponse.json({ slips: slips || [] });
    }

    if (body.action === 'DELETE_PAYROLL_SLIP') {
      const { slip_id } = body.payload;
      const { data: slip } = await supabase.from('payroll_slips').select('*').eq('id', slip_id).single();
      if (!slip) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
      
      // Can only delete if created_at is in the current month
      const now = new Date();
      const createdDate = new Date(slip.created_at);
      if (now.getMonth() !== createdDate.getMonth() || now.getFullYear() !== createdDate.getFullYear()) {
        return NextResponse.json({ error: "Cannot delete slips from previous months" }, { status: 400 });
      }

      if (slip.status === 'APPROVED' && adminRole !== 'super_admin') {
        return NextResponse.json({ error: "ไม่สามารถลบสลิปที่อนุมัติแล้วได้" }, { status: 403 });
      }

      await supabase.from('payroll_slips').delete().eq('id', slip_id);
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'DELETE_PAYROLL_SLIP', target_table: 'payroll_slips', record_id: slip_id, old_data: slip, comment: `ลบสลิปเดือน ${slip.month}` });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'APPROVE_PAYROLL_SLIP') {
      const { slip_id, status, admin_comment } = body.payload;
      const { data: slip } = await supabase.from('payroll_slips').select('*').eq('id', slip_id).single();
      if (!slip) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
      
      if (slip.created_by === adminId && adminRole !== 'super_admin') {
         return NextResponse.json({ error: "Cannot approve your own slip" }, { status: 403 });
      }

      await supabase.from('payroll_slips').update({ status, admin_comment, approved_by: adminId }).eq('id', slip_id);
      await supabase.from('time_tracking_audit_logs').insert({ admin_id: adminId, action: 'APPROVE_PAYROLL_SLIP', target_table: 'payroll_slips', record_id: slip_id, old_data: slip, new_data: { status, admin_comment, approved_by: adminId }, comment: admin_comment });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
