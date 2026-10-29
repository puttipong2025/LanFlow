-- Bounded pending/history pages use a full (time, UUID) cursor, including ties.
create function public.list_rubber_queue(p_location_id uuid,p_history boolean default false,
  p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; counts jsonb;
begin
  if not private.rubber_actor_location(p_location_id) then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(private.rubber_queue_view(j) order by j.accepted_at desc,j.command_id desc),'[]') into rows
    from (select * from private.rubber_queue_jobs where location_id=p_location_id
      and case when p_history then state='done' else state<>'done' end
      and (p_before is null or (accepted_at,command_id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by accepted_at desc,command_id desc limit greatest(1,least(coalesce(p_limit,50),100))) j;
  select jsonb_build_object('pending',count(*) filter(where state<>'done'),
    'attention',count(*) filter(where state in ('paused','correction_required')),
    'oldestAcceptedAt',min(accepted_at) filter(where state<>'done')) into counts
    from private.rubber_queue_jobs where location_id=p_location_id;
  return jsonb_build_object('rows',rows,'counts',counts);
end $$;
revoke all on function public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer) to authenticated;
