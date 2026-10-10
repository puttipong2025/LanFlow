begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.has_column('public', 'money_transfers', 'branch_receipt_contract_version', 'branch receipt rows carry an explicit contract version');
select extensions.has_column('public', 'money_transfers', 'branch_receipt_status', 'branch receipt lifecycle is separate from transfer status');
select extensions.has_column('public', 'money_transfers', 'branch_received_by_user_id', 'branch receipt stores the confirmer identity');
select extensions.has_column('public', 'money_transfers', 'branch_received_by_name', 'branch receipt stores the confirmer snapshot');
select extensions.has_column('public', 'money_transfers', 'branch_received_at', 'branch receipt stores the server confirmation time');

select extensions.has_table('public', 'branch_transfer_delete_requests', 'bank branch deletion requests do not reuse the cash-only table');
select extensions.has_function('private', 'money_transfer_is_financially_effective', array['money_transfers'], 'one predicate gates branch financial reads');
select extensions.has_function('public', 'receive_branch_money_transfer', array['uuid', 'integer'], 'receiver confirmation is one server-authoritative RPC');
select extensions.has_function('public', 'get_pending_branch_money_transfers', array['uuid'], 'recipient queue is a server-side read seam');
select extensions.has_function('public', 'request_branch_money_transfer_delete', array['uuid', 'integer'], 'received branch deletion uses a dedicated request seam');
select extensions.has_function('public', 'decide_branch_transfer_delete_request', array['uuid', 'text', 'text'], 'central managers decide bank branch deletion requests');

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'reject_future_money_transfer_slip'
      and tgenabled = 'O'
  ),
  'all money transfer slip writes enforce server-time future validation'
);

select * from extensions.finish();
rollback;
