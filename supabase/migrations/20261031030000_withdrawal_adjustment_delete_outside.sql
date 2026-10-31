-- Reuse the existing payroll planner and permanent-delete boundary.
begin;

alter table public.financial_transactions drop constraint financial_transactions_adjustment_expense_assignment;
alter table public.financial_transactions add constraint financial_transactions_adjustment_expense_assignment
 check (type <> 'ADJUSTMENT' or status <> 'APPROVED' or cancelled_at is not null or approved_at is not null);

-- Keep the adjustment wrapper for existing callers, but rebuild by the surviving source.
do $migration$
declare definition text; old_lookup text := $old$    from public.financial_transactions adjustment
    where adjustment.id = p_adjustment_id
      and adjustment.type = 'ADJUSTMENT'
      and adjustment.cancelled_at is null
      and adjustment.parent_debt_id = source.id$old$;
begin
 old_lookup:=replace(old_lookup,chr(13),'');
 select pg_get_functiondef('private.rebuild_open_deductions_for_adjustment(uuid,uuid,uuid)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 if strpos(definition,old_lookup)=0 then raise exception 'ADJUSTMENT_REBUILD_PATCH_BLOCKED'; end if;
 definition:=replace(definition,
 'private.rebuild_open_deductions_for_adjustment(p_profile_id uuid, p_actor uuid, p_adjustment_id uuid)',
 'private.rebuild_open_withdrawal_deductions(p_profile_id uuid, p_actor uuid, p_withdrawal_id uuid, p_adjustment_id uuid)');
 execute replace(definition,old_lookup,'    where source.id = p_withdrawal_id');
end $migration$;

create or replace function private.rebuild_open_deductions_for_adjustment(p_profile_id uuid, p_actor uuid, p_adjustment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source_id uuid;
begin
 select parent_debt_id into source_id from public.financial_transactions where id=p_adjustment_id and type='ADJUSTMENT' and cancelled_at is null;
 if source_id is null then raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND'; end if;
 return private.rebuild_open_withdrawal_deductions(p_profile_id,p_actor,source_id,p_adjustment_id);
end $$;
revoke all on function private.rebuild_open_withdrawal_deductions(uuid,uuid,uuid,uuid) from public,anon,authenticated;

do $migration$
declare definition text; old_guard text := $old$  if v_is_manager and (
    p_expense_location_id is null
    or not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  ) then raise exception 'ADJUSTMENT_BRANCH_REQUIRED'; end if;$old$;
begin
 old_guard:=replace(old_guard,chr(13),'');
 select pg_get_functiondef('public.request_time_tracking_withdrawal_adjustment(uuid,numeric,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 if strpos(definition,old_guard)=0 then raise exception 'ADJUSTMENT_REQUEST_PATCH_BLOCKED'; end if;
 execute replace(definition,old_guard,$new$  if v_is_manager and p_expense_location_id is not null
    and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  then raise exception 'ADJUSTMENT_BRANCH_REQUIRED'; end if;$new$);
end $migration$;

do $migration$
declare definition text; old_guard text := $old$  if p_expense_location_id is null
    or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then$old$;
begin
 old_guard:=replace(old_guard,chr(13),'');
 select pg_get_functiondef('public.decide_time_tracking_withdrawal_adjustment(uuid,text,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 if strpos(definition,old_guard)=0
   or strpos(definition,'  v_payload := private.dashboard_money_event_entry(')=0
   or strpos(definition,'  on conflict (source_type, source_id, event_key) do update set payload = excluded.payload;')=0
 then raise exception 'ADJUSTMENT_DECISION_PATCH_BLOCKED'; end if;
 definition:=replace(definition,old_guard,$new$  if p_expense_location_id is not null
    and not private.can_assign_time_tracking_expense_location(p_expense_location_id) then$new$);
 definition:=replace(definition,'  v_payload := private.dashboard_money_event_entry(',
   E'  if p_expense_location_id is not null then\n  v_payload := private.dashboard_money_event_entry(');
 execute replace(definition,'  on conflict (source_type, source_id, event_key) do update set payload = excluded.payload;',
   E'  on conflict (source_type, source_id, event_key) do update set payload = excluded.payload;\n  end if;');
end $migration$;

-- The outstanding snapshot includes every source through the slip's month,
-- including a zero target omitted from printable rows. Slips before approval do not depend on this correction.
create or replace function private.withdrawal_adjustment_blocking_slip(p_adjustment_id uuid)
returns table(id uuid, month text, status text) language sql stable security definer set search_path='' as $$
 select slip.id,slip.month,slip.status::text
 from public.financial_transactions adjustment
 join public.financial_transactions source on source.id=adjustment.parent_debt_id
 join public.payroll_slips slip on slip.profile_id=source.profile_id
 where adjustment.id=p_adjustment_id and adjustment.type='ADJUSTMENT'
   and slip.status in ('PENDING','APPROVED') and slip.cancelled_at is null
   and slip.created_at >= coalesce(adjustment.approved_at,adjustment.created_at)
   and source.effective_date < ((slip.month||'-01')::date+interval '1 month')::date
 order by slip.month,slip.created_at,slip.id limit 1
$$;
revoke all on function private.withdrawal_adjustment_blocking_slip(uuid) from public,anon,authenticated;

create or replace function private.delete_withdrawal_adjustment(p_adjustment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); adjustment public.financial_transactions%rowtype;
 source public.financial_transactions%rowtype; latest_id uuid; report_no text; slip record;
 old_flag text:=current_setting('app.time_tracking_permanent_delete_rpc',true);
begin
 if actor is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
 select * into adjustment from public.financial_transactions where id=p_adjustment_id and type='ADJUSTMENT';
 if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
 if not private.can_manage_time_payroll_profile(adjustment.profile_id) then raise exception 'Forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended('time-tracking:'||adjustment.profile_id::text,0));
 select * into adjustment from public.financial_transactions where id=p_adjustment_id and type='ADJUSTMENT' for update;
 if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
 select * into source from public.financial_transactions where id=adjustment.parent_debt_id for update;
 if not found or source.type<>'WITHDRAWAL' or source.status<>'APPROVED' or source.cancelled_at is not null then
   raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND'; end if;
 if adjustment.status<>'APPROVED' or adjustment.cancelled_at is not null then raise exception 'ADJUSTMENT_ALREADY_DECIDED'; end if;
 if not private.is_global_time_payroll_manager() and adjustment.expense_location_id is not null
   and not private.can_assign_time_tracking_expense_location(adjustment.expense_location_id) then
   raise exception 'Existing expense location access denied'; end if;
 -- The planner can touch all open parents of this employee. Fence all affected branches in sorted order.
 perform private.lock_report_locations(array(
   select distinct expense_location_id from public.financial_transactions
   where profile_id=adjustment.profile_id and status='APPROVED' and cancelled_at is null
     and type in ('DEBT','WITHDRAWAL','ADJUSTMENT') and expense_location_id is not null));
 select id into latest_id from public.financial_transactions
 where parent_debt_id=source.id and type='ADJUSTMENT' and status='APPROVED' and cancelled_at is null
 order by approved_at desc nulls last,created_at desc,id desc limit 1;
 if latest_id is distinct from adjustment.id then raise exception 'ADJUSTMENT_NOT_LATEST'; end if;
 if exists(select 1 from public.financial_transactions where parent_debt_id=source.id
   and type='ADJUSTMENT' and status='PENDING' and cancelled_at is null) then raise exception 'ADJUSTMENT_PENDING_EXISTS'; end if;
 report_no:=private.active_report_no('financial_transaction',adjustment.id);
 if report_no is not null then perform private.raise_report_lock(report_no); end if;
 select * into slip from private.withdrawal_adjustment_blocking_slip(adjustment.id);
 if found then raise exception 'MONTH_CLOSED:%:PAYROLL_SLIP:%:%',slip.month,slip.status,slip.id; end if;
 if adjustment.adjustment_base_amount < private.withdrawal_closed_floor(source.id) then
   raise exception 'ADJUSTMENT_BELOW_CLOSED_FLOOR:%',private.withdrawal_closed_floor(source.id); end if;
 perform set_config('app.time_tracking_permanent_delete_rpc','true',true);
 delete from public.financial_transactions where id=adjustment.id;
 perform set_config('app.time_tracking_permanent_delete_rpc',coalesce(nullif(old_flag,''),'false'),true);
 perform private.rebuild_open_withdrawal_deductions(adjustment.profile_id,actor,source.id,adjustment.id);
 insert into public.time_tracking_audit_logs(admin_id,action,target_table,record_id,old_data,new_data,comment)
 values(actor,'DELETE_WITHDRAWAL_ADJUSTMENT','financial_transactions',adjustment.id,to_jsonb(adjustment),
 jsonb_build_object('withdrawalId',source.id,'targetAmount',private.latest_withdrawal_target(source.id)),
 'ลบการปรับยอดล่าสุดและคืนยอดเดือนเปิด');
 return jsonb_build_object('status','deleted','sourceType','transaction','sourceId',adjustment.id,'withdrawalId',source.id);
end $$;
revoke all on function private.delete_withdrawal_adjustment(uuid) from public,anon,authenticated;

do $migration$
declare definition text; anchor text := E'  if p_source_type = ''transaction'' then\n    select * into v_tx';
begin
 select pg_get_functiondef('public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 if strpos(definition,anchor)=0 then raise exception 'ADJUSTMENT_DELETE_PATCH_BLOCKED'; end if;
 execute replace(definition,anchor,$new$  if p_source_type = 'transaction' and exists(
    select 1 from public.financial_transactions where id=p_source_id and type='ADJUSTMENT'
  ) then return private.delete_withdrawal_adjustment(p_source_id); end if;

  if p_source_type = 'transaction' then
    select * into v_tx$new$);
end $migration$;

do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.get_withdrawal_adjustment_summaries(uuid)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 if strpos(definition,'''pendingAdjustmentId'', pending.id')=0
   or strpos(definition,'    where source.profile_id = p_profile_id')=0 then raise exception 'ADJUSTMENT_SUMMARY_PATCH_BLOCKED'; end if;
 definition:=replace(definition,'''pendingAdjustmentId'', pending.id',$new$'pendingAdjustmentId', pending.id,
      'latestApprovedAdjustmentId', latest.id,
      'blockingSlip', (select to_jsonb(blocker) from private.withdrawal_adjustment_blocking_slip(latest.id) blocker)$new$);
 execute replace(definition,'    where source.profile_id = p_profile_id',$new$    left join lateral (
      select adjustment.id from public.financial_transactions adjustment
      where adjustment.parent_debt_id=source.id and adjustment.type='ADJUSTMENT'
        and adjustment.status='APPROVED' and adjustment.cancelled_at is null
      order by adjustment.approved_at desc nulls last,adjustment.created_at desc,adjustment.id desc limit 1
    ) latest on true
    where source.profile_id = p_profile_id$new$);
end $migration$;

notify pgrst,'reload schema';
commit;
