-- OCR tickets linked to money_transfer_items cannot be edited or deleted.
-- Unlocking requires removing the item from the transfer.

create or replace function public.prevent_locked_ocr_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    where i.source_type = 'ocr_ticket'
      and i.source_id = old.id
      and t.record_status <> 'deleted'
  ) then
    raise exception 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_locked_ocr_ticket_change() from public, anon, authenticated;

drop trigger if exists ocr_tickets_transfer_relation_update_lock on public.ocr_tickets;
create trigger ocr_tickets_transfer_relation_update_lock
  before update on public.ocr_tickets
  for each row
  execute function public.prevent_locked_ocr_ticket_change();

drop trigger if exists ocr_tickets_transfer_relation_delete_lock on public.ocr_tickets;
create trigger ocr_tickets_transfer_relation_delete_lock
  before delete on public.ocr_tickets
  for each row
  execute function public.prevent_locked_ocr_ticket_change();
