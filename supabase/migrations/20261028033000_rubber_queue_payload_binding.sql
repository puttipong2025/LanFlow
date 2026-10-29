-- Qualify the function argument independently of the queue's payload column.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure);
  body:=replace(body,'where command_id::text=payload->>''idempotencyKey''',
    'where command_id::text=sync_rubber_bill.payload->>''idempotencyKey''');
  execute body;
end $$;
