-- A row count is not a safe next document number after scoped maintenance or
-- test cleanup removes a bill. Keep the existing per-location/date lock and
-- advance from the highest persisted suffix instead.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.sync_rubber_bill_legacy_core_20260824010000(jsonb)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$      select count(*) + 1 into v_next_seq
      from public.rubber_bills
      where location_id = v_location_id
        and to_char(bill_date, 'YYMMDD') = v_date
        and server_bill_no is not null;$old$,
    $new$      select coalesce(max(
        case
          when server_bill_no ~ ('^' || v_date || '[0-9]+$')
            then substring(server_bill_no from char_length(v_date) + 1)::integer
          else null
        end
      ), 0) + 1 into v_next_seq
      from public.rubber_bills
      where location_id = v_location_id
        and to_char(bill_date, 'YYMMDD') = v_date
        and server_bill_no is not null;$new$
  );

  if v_updated = v_definition then
    raise exception 'rubber bill number allocation branch not found';
  end if;

  execute v_updated;
end;
$migration$;
