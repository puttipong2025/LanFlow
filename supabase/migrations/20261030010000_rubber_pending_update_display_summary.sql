-- Keep compact pending-update values available in the existing branch-scoped feed.
-- Authorization and the manager-only approval mode remain in the existing function.
do $migration$
declare
  body text;
  changed text;
begin
  select pg_get_functiondef('public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure) into body;
  changed := replace(body,
    'case when req.id is null or p_mode <> ''pending_approval'' then null else jsonb_build_object(',
    'case when req.id is null or (p_mode <> ''pending_approval'' and req.operation <> ''update'') then null else jsonb_build_object(');
  if changed = body then raise exception 'Expected pending summary definition missing'; end if;
  execute changed;
end;
$migration$;
