-- Branch-receipt bills share the daily Rubber Bill number namespace. A row
-- count can reuse an existing suffix after scoped cleanup removes a middle
-- bill, so advance from the highest valid persisted suffix under the existing
-- per-location/date advisory lock.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_branch_rubber_receipt(uuid,uuid,numeric)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$  select count(*) + 1
  into v_next_seq
  from public.rubber_bills b
  where b.location_id = p_destination_location_id
    and to_char(b.bill_date, 'YYMMDD') = v_date_key
    and b.server_bill_no is not null;$old$,
    $new$  select coalesce(max(
    case
      when b.server_bill_no ~ ('^' || v_date_key || '[0-9]+$')
        then substring(b.server_bill_no from char_length(v_date_key) + 1)::integer
      else null
    end
  ), 0) + 1
  into v_next_seq
  from public.rubber_bills b
  where b.location_id = p_destination_location_id
    and to_char(b.bill_date, 'YYMMDD') = v_date_key
    and b.server_bill_no is not null;$new$
  );

  if v_updated = v_definition then
    raise exception 'branch receipt bill number allocation branch not found';
  end if;

  execute v_updated;
end;
$migration$;
