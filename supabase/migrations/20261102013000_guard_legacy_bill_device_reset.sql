-- A DB-first rollout must not let the previous web server's 3-argument RPC
-- execute the newly destructive clear. The old entry point is replay-only.
begin;
do $migration$
declare body text; changed text;
begin
  body := pg_get_functiondef('public.reset_all_bill_devices(uuid,text,text)'::regprocedure);
  changed := replace(body, '(p_request_id uuid, p_snapshot text, p_confirmation text)',
    '(p_request_id uuid, p_snapshot text, p_confirmation text, p_mode text)');
  if changed = body then raise exception 'Explicit reset operation signature boundary missing'; end if;
  body := changed;
  changed := replace(body, '  if p_request_id is null',
    '  if p_mode is distinct from ''clear_registry_v1'' then' || chr(10) ||
    '    raise exception ''BILL_DEVICE_RESET_REQUIRES_CURRENT_UI'' using errcode = ''22023'';' || chr(10) ||
    '  end if;' || chr(10) || '  if p_request_id is null');
  if changed = body then raise exception 'Explicit reset operation guard boundary missing'; end if;
  execute changed;
end $migration$;

create or replace function public.reset_all_bill_devices(p_request_id uuid, p_snapshot text, p_confirmation text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare receipt private.bill_device_reset_receipts;
begin
  if not private.rubber_actor_active() or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'super_admin'
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_request_id is null or p_snapshot is null or p_snapshot !~ '^[a-f0-9]{64}$'
    or p_confirmation is distinct from 'รีเซ็ตทั้งหมด' then
    raise exception 'BILL_DEVICE_RESET_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bill-device-reset:' || p_request_id::text, 0));
  select * into receipt from private.bill_device_reset_receipts where request_id = p_request_id;
  if not found then
    raise exception 'BILL_DEVICE_RESET_REQUIRES_CURRENT_UI' using errcode = '22023';
  end if;
  if receipt.actor_user_id is distinct from auth.uid() or receipt.snapshot is distinct from p_snapshot then
    raise exception 'BILL_DEVICE_RESET_REQUEST_MISMATCH' using errcode = '22023';
  end if;
  return jsonb_build_object('requestId', receipt.request_id, 'snapshot', receipt.snapshot,
    'retiredCount', receipt.retired_count, 'completedAt', receipt.completed_at, 'mode', receipt.reset_mode);
end $$;

revoke all on function public.reset_all_bill_devices(uuid,text,text,text) from public, anon;
grant execute on function public.reset_all_bill_devices(uuid,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
