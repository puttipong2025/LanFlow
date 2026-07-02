do $$
begin
  if to_regclass('public.debts') is not null then
    insert into public.financial_transactions (
      profile_id,
      type,
      amount,
      status,
      remaining_amount,
      description,
      admin_comment,
      created_at,
      updated_at
    )
    select
      d.profile_id,
      'DEBT'::public.financial_transaction_type,
      greatest(d.total_amount, d.remaining_amount),
      'APPROVED'::public.approval_status,
      d.remaining_amount,
      'Migrated legacy debt balance',
      'Migrated from public.debts before dropping the legacy table',
      d.created_at,
      coalesce(d.updated_at, d.created_at)
    from public.debts d
    where d.remaining_amount > 0
      and not exists (
        select 1
        from public.financial_transactions ft
        where ft.profile_id = d.profile_id
          and ft.type in ('DEBT', 'WITHDRAWAL')
          and ft.status = 'APPROVED'
          and ft.remaining_amount > 0
      );

    drop table public.debts cascade;
  end if;
end $$;

alter table public.time_tracking_audit_logs
  alter column comment set default '',
  alter column comment drop not null;
