begin;
alter table public.payroll_slips
  add column history_creator_name text not null default 'ไม่ทราบผู้สร้างรายการ';

-- Source-name metadata only: keep locked payroll values/timestamps and events intact.
alter table public.payroll_slips disable trigger report_lock_payroll_slips;
alter table public.payroll_slips disable trigger handle_updated_at;
alter table public.payroll_slips disable trigger dashboard_dirty_payroll_slips;
alter table public.payroll_slips disable trigger dashboard_money_event_payroll;
update public.payroll_slips s set history_creator_name = p.name
from public.profiles p where p.id = s.created_by;
alter table public.payroll_slips enable trigger report_lock_payroll_slips;
alter table public.payroll_slips enable trigger handle_updated_at;
alter table public.payroll_slips enable trigger dashboard_dirty_payroll_slips;
alter table public.payroll_slips enable trigger dashboard_money_event_payroll;

create function private.capture_payroll_history_creator_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(name, ''), 'ไม่ทราบผู้สร้างรายการ') into new.history_creator_name
    from public.profiles where id = new.created_by;
    new.history_creator_name := coalesce(new.history_creator_name, 'ไม่ทราบผู้สร้างรายการ');
  else
    new.history_creator_name := old.history_creator_name;
  end if;
  return new;
end;
$$;
create trigger payroll_history_creator_name before insert or update on public.payroll_slips
for each row execute function private.capture_payroll_history_creator_name();
revoke all on function private.capture_payroll_history_creator_name() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
