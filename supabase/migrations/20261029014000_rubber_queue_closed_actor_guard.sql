-- profiles are deliberately independent of auth.users in this project. A deleted
-- Auth account must not continue executing even if its old profile stays active.
do $$ declare body text; begin
  body:=pg_get_functiondef('private.process_rubber_queue_batch(integer,uuid)'::regprocedure);
  body:=replace(body,'if not private.rubber_actor_location(j.location_id)',
    'if not exists(select 1 from auth.users where id=j.actor_user_id)
        or not private.rubber_actor_location(j.location_id)');
  execute body;
end $$;
