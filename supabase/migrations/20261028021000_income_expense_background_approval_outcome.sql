-- Preserve terminal approval decisions before disposable history can be pruned.
create function private.capture_income_background_approval_outcome()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.request_status in ('approved','rejected') then
    update private.income_expense_background_commands
    set result = result || jsonb_build_object('outcome',case when new.request_status='approved' then 'synced' else 'rejected' end)
    where result->>'requestId'=new.id::text and result->>'outcome'='pending_approval';
  end if;
  return new;
end $$;
revoke all on function private.capture_income_background_approval_outcome() from public,anon,authenticated;
create trigger income_background_approval_outcome after update of request_status
  on public.income_expense_approval_requests for each row
  execute function private.capture_income_background_approval_outcome();
