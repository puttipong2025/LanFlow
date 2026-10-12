begin;
select extensions.plan(1);

select extensions.ok(
  to_regprocedure('private.merge_pending_money_transfers(uuid)') is null,
  'obsolete private Money Transfer merge implementation is removed'
);

select * from extensions.finish();
rollback;
