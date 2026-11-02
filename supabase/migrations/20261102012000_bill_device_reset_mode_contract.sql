-- The old retire-only operation and new clear operation must never acknowledge
-- each other, including during a partial/rolling deployment or receipt replay.
begin;
alter table private.bill_device_reset_receipts
  add column reset_mode text not null default 'legacy_v1'
  check (reset_mode in ('legacy_v1', 'clear_registry_v1'));

do $migration$
declare body text; changed text;
begin
  body := pg_get_functiondef('public.preview_bill_device_reset()'::regprocedure);
  changed := replace(body, 'return private.bill_device_reset_snapshot();',
    'return private.bill_device_reset_snapshot() || ''{"mode":"clear_registry_v1"}''::jsonb;');
  if changed = body then raise exception 'Reset preview mode boundary missing'; end if;
  execute changed;

  body := pg_get_functiondef('public.reset_all_bill_devices(uuid,text,text)'::regprocedure);
  changed := replace(body, 'insert into private.bill_device_reset_receipts values' || chr(10) ||
    '      (p_request_id, auth.uid(), p_snapshot, (preview->>''count'')::bigint, finished)',
    'insert into private.bill_device_reset_receipts' || chr(10) ||
    '      (request_id, actor_user_id, snapshot, retired_count, completed_at, reset_mode) values' || chr(10) ||
    '      (p_request_id, auth.uid(), p_snapshot, (preview->>''count'')::bigint, finished, ''clear_registry_v1'')');
  if changed = body then raise exception 'Reset receipt mode insert boundary missing'; end if;
  body := changed;
  changed := replace(body, '''completedAt'', receipt.completed_at);',
    '''completedAt'', receipt.completed_at, ''mode'', receipt.reset_mode);');
  if changed = body then raise exception 'Reset receipt mode result boundary missing'; end if;
  execute changed;
end $migration$;
notify pgrst, 'reload schema';
commit;
