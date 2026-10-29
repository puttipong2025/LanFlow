do $$ declare body text; begin
  body:=pg_get_functiondef('public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer,text)'::regprocedure);
  body:=replace(body,'declare rows jsonb; counts jsonb;', 'declare rows jsonb; counts jsonb; notices jsonb;');
  body:=replace(body,'return jsonb_build_object(''rows'',rows,''counts'',counts);',
    'select coalesce(jsonb_agg(private.rubber_queue_view(j) order by j.completed_at desc,j.command_id),''[]'') into notices
      from (select * from private.rubber_queue_jobs where location_id=p_location_id and state=''done''
        and error_code is not null and error_code<>''BILL_ALREADY_DELETED''
        order by completed_at desc,command_id limit 5) j;
    return jsonb_build_object(''rows'',rows,''counts'',counts,''notices'',notices);');
  execute body;
end $$;
