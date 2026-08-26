-- Flush deferred trigger events before the cost-basis migration re-enables guards.

begin;

lock table public.rubber_export_items, public.rubber_exports in access exclusive mode;

alter table public.rubber_exports disable trigger guard_rubber_export_state;
alter table public.rubber_exports disable trigger report_lock_rubber_exports;

update public.rubber_exports e
set average_price = round(e.rubber_value_total / e.original_weight_total, 2)
where e.average_price is distinct from round(e.rubber_value_total / e.original_weight_total, 2);

set constraints all immediate;

alter table public.rubber_exports enable trigger guard_rubber_export_state;
alter table public.rubber_exports enable trigger report_lock_rubber_exports;

do $$
begin
  if exists (
    select 1
    from public.rubber_exports e
    where e.average_price is distinct from round(e.rubber_value_total / e.original_weight_total, 2)
  ) then
    raise exception 'RUBBER_EXPORT_COST_BACKFILL_INCOMPLETE';
  end if;

  if (
    select count(*)
    from pg_trigger
    where tgrelid = 'public.rubber_exports'::regclass
      and tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
      and tgenabled = 'O'
  ) <> 2 then
    raise exception 'RUBBER_EXPORT_COST_BACKFILL_TRIGGER_STATE_INVALID';
  end if;
end;
$$;

commit;
