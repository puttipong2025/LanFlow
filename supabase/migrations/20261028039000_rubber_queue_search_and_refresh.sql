alter function public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer) rename to list_rubber_queue_before_search;
revoke all on function public.list_rubber_queue_before_search(uuid,boolean,timestamptz,uuid,integer) from public,anon,authenticated;
do $$ declare body text; begin
  body:=pg_get_functiondef('public.list_rubber_queue_before_search(uuid,boolean,timestamptz,uuid,integer)'::regprocedure);
  body:=replace(body,'public.list_rubber_queue_before_search(', 'public.list_rubber_queue(');
  body:=replace(body,'p_limit integer DEFAULT 50)', 'p_limit integer DEFAULT 50, p_search text DEFAULT '''')');
  body:=replace(body,'and case when p_history then state=''done'' else state<>''done'' end',
    'and strpos(lower(reference||'' ''||client_temp_id),lower(left(coalesce(p_search,''''),512)))>0
      and case when p_history then state=''done'' else state<>''done'' end');
  body:=replace(body,'''pending'',count(*)', '''revision'',coalesce(sum(version),0)::text,''pending'',count(*)');
  execute body;
end $$;
revoke all on function public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer,text) from public,anon;
grant execute on function public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer,text) to authenticated;
