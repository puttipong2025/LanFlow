-- Gate Money Transfer writes behind an explicit super_admin-controlled profile flag.
-- SELECT remains branch-scoped so Income/Expense can still render derived locked rows
-- from money_transfers for users who can access the relevant branch.

alter table public.profiles
  add column if not exists can_access_money_transfer boolean not null default false;

update public.profiles
set can_access_money_transfer = true
where role = 'super_admin';

grant select (can_access_money_transfer), update (can_access_money_transfer)
  on public.profiles to authenticated;

create or replace function private.can_access_money_transfer_module()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('user', 'admin')
        and p.can_access_money_transfer = true
    )
$$;

revoke all on function private.can_access_money_transfer_module() from public, anon;
grant execute on function private.can_access_money_transfer_module() to authenticated;

drop policy if exists "money_transfers_location_scope" on public.money_transfers;
drop policy if exists "money transfers location scoped select" on public.money_transfers;
drop policy if exists "money transfers location scoped insert" on public.money_transfers;
drop policy if exists "money transfers location scoped update" on public.money_transfers;
drop policy if exists "money transfers location scoped delete" on public.money_transfers;

create policy "money_transfers_select_location_scope"
  on public.money_transfers for select to authenticated
  using (private.can_access_location(location_id));

create policy "money_transfers_insert_module_scope"
  on public.money_transfers for insert to authenticated
  with check (
    private.can_access_money_transfer_module()
    and private.can_access_location(location_id)
  );

create policy "money_transfers_update_module_scope"
  on public.money_transfers for update to authenticated
  using (
    private.can_access_money_transfer_module()
    and private.can_access_location(location_id)
  )
  with check (
    private.can_access_money_transfer_module()
    and private.can_access_location(location_id)
  );

create policy "money_transfers_delete_module_scope"
  on public.money_transfers for delete to authenticated
  using (
    private.can_access_money_transfer_module()
    and private.can_access_location(location_id)
  );

drop policy if exists "money_transfer_slips_parent_scope" on public.money_transfer_slips;
drop policy if exists "money transfer slips scoped through transfer" on public.money_transfer_slips;

create policy "money_transfer_slips_select_parent_scope"
  on public.money_transfer_slips for select to authenticated
  using (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_slips_insert_module_scope"
  on public.money_transfer_slips for insert to authenticated
  with check (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_slips_update_module_scope"
  on public.money_transfer_slips for update to authenticated
  using (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  )
  with check (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_slips_delete_module_scope"
  on public.money_transfer_slips for delete to authenticated
  using (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

drop policy if exists "money_transfer_items_parent_scope" on public.money_transfer_items;
drop policy if exists "money transfer items scoped through transfer" on public.money_transfer_items;

create policy "money_transfer_items_select_parent_scope"
  on public.money_transfer_items for select to authenticated
  using (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_items_insert_module_scope"
  on public.money_transfer_items for insert to authenticated
  with check (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_items_update_module_scope"
  on public.money_transfer_items for update to authenticated
  using (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  )
  with check (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_items_delete_module_scope"
  on public.money_transfer_items for delete to authenticated
  using (
    private.can_access_money_transfer_module()
    and exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );
