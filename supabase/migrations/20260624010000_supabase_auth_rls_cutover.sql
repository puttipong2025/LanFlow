-- Supabase Auth + RLS cutover for LanFlow.
-- Apply before switching application CRUD from service_role to user-scoped clients.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Disable the known development credential if it still exists.
update public.profiles
set password_hash = null,
    updated_at = now()
where phone = '0800000000'
  and password_hash is not null
  and crypt('admin1234', password_hash) = password_hash;

drop function if exists public.hash_password(text);
drop function if exists public.verify_password(text, text);

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  )
$$;

create or replace function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'super_admin', false)
$$;

create or replace function private.can_access_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.is_active_user()
      and target_location is not null
      and exists (
        select 1
        from public.user_locations ul
        where ul.user_id = auth.uid()
          and ul.location_id = target_location
      )
    )
$$;

create or replace function private.can_access_optional_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      target_location is not null
      and private.can_access_location(target_location)
    )
$$;

create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.is_super_admin()
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.user_locations mine
          join public.user_locations theirs
            on theirs.location_id = mine.location_id
          where mine.user_id = auth.uid()
            and theirs.user_id = target_user
        )
      )
    )
$$;

create or replace function private.can_manage_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.current_user_role() = 'admin'
      and private.can_access_location(target_location)
    )
$$;

create or replace function private.can_manage_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or (
      private.current_user_role() = 'admin'
      and exists (
        select 1
        from public.profiles target
        where target.id = target_user
          and target.role = 'user'
          and target.is_active = true
      )
      and exists (
        select 1
        from public.user_locations mine
        join public.user_locations theirs
          on theirs.location_id = mine.location_id
        where mine.user_id = auth.uid()
          and theirs.user_id = target_user
      )
    )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.can_access_location(uuid) to authenticated;
grant execute on function private.can_access_optional_location(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_manage_location(uuid) to authenticated;
grant execute on function private.can_manage_profile(uuid) to authenticated;

-- Keep compatibility for any database code that still calls the old helpers.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
$$;

create or replace function public.can_access_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_location(target_location)
$$;

revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.can_access_location(uuid) from public, anon;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.can_access_location(uuid) to authenticated;

-- Remove every legacy policy on the application tables so the policy set below
-- is the only authorization model.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles',
        'locations',
        'user_locations',
        'customers',
        'customer_contacts',
        'customer_bank_accounts',
        'customer_farms',
        'rubber_bills',
        'rubber_bill_items',
        'income_expense',
        'ocr_tickets',
        'offline_sync_events',
        'audit_logs',
        'transport_staffs',
        'transport_staff_contacts',
        'transport_staff_bank_accounts',
        'transport_staff_plates',
        'money_transfers',
        'money_transfer_slips',
        'money_transfer_items'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

-- Authenticated users need SQL privileges in addition to RLS policies.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles,
  public.locations,
  public.user_locations,
  public.customers,
  public.customer_contacts,
  public.customer_bank_accounts,
  public.customer_farms,
  public.rubber_bills,
  public.rubber_bill_items,
  public.income_expense,
  public.ocr_tickets,
  public.offline_sync_events,
  public.audit_logs,
  public.transport_staffs,
  public.transport_staff_contacts,
  public.transport_staff_bank_accounts,
  public.transport_staff_plates,
  public.money_transfers,
  public.money_transfer_slips,
  public.money_transfer_items
to authenticated;

-- Password hashes are migration-only secrets. Authenticated users must never
-- be able to select the legacy column even from their own profile.
revoke all on table public.profiles from authenticated;
grant select (id, phone, name, role, is_active, created_at, updated_at)
  on public.profiles to authenticated;
grant update (name, role, is_active, updated_at)
  on public.profiles to authenticated;

-- Profiles and branch assignments.
create policy "profiles_select_authorized"
  on public.profiles for select to authenticated
  using (private.can_view_profile(id));

create policy "profiles_update_super_admin"
  on public.profiles for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

create policy "locations_select_assigned"
  on public.locations for select to authenticated
  using (private.can_access_location(id));

create policy "locations_manage_super_admin"
  on public.locations for all to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

create policy "user_locations_select_authorized"
  on public.user_locations for select to authenticated
  using (
    private.is_active_user()
    and (
      user_id = auth.uid()
      or private.can_view_profile(user_id)
    )
  );

create policy "user_locations_insert_scoped_admin"
  on public.user_locations for insert to authenticated
  with check (
    private.can_manage_location(location_id)
    and private.can_manage_profile(user_id)
  );

create policy "user_locations_update_scoped_admin"
  on public.user_locations for update to authenticated
  using (
    private.can_manage_location(location_id)
    and private.can_manage_profile(user_id)
  )
  with check (
    private.can_manage_location(location_id)
    and private.can_manage_profile(user_id)
  );

create policy "user_locations_delete_scoped_admin"
  on public.user_locations for delete to authenticated
  using (
    private.can_manage_location(location_id)
    and private.can_manage_profile(user_id)
  );

-- Customers: NULL location is visible only to super admin, never implicitly global.
create policy "customers_select_location"
  on public.customers for select to authenticated
  using (private.can_access_optional_location(default_location_id));

create policy "customers_insert_location"
  on public.customers for insert to authenticated
  with check (private.can_access_optional_location(default_location_id));

create policy "customers_update_location"
  on public.customers for update to authenticated
  using (private.can_access_optional_location(default_location_id))
  with check (private.can_access_optional_location(default_location_id));

create policy "customers_delete_location"
  on public.customers for delete to authenticated
  using (private.can_access_optional_location(default_location_id));

create policy "customer_contacts_parent_scope"
  on public.customer_contacts for all to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  );

create policy "customer_bank_accounts_parent_scope"
  on public.customer_bank_accounts for all to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  );

create policy "customer_farms_parent_scope"
  on public.customer_farms for all to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and private.can_access_optional_location(c.default_location_id)
    )
  );

-- Rubber bills and income/expense.
create policy "rubber_bills_location_scope"
  on public.rubber_bills for all to authenticated
  using (private.can_access_location(location_id))
  with check (private.can_access_location(location_id));

create policy "rubber_bill_items_parent_scope"
  on public.rubber_bill_items for all to authenticated
  using (
    exists (
      select 1
      from public.rubber_bills b
      where b.id = bill_id
        and private.can_access_location(b.location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.rubber_bills b
      where b.id = bill_id
        and private.can_access_location(b.location_id)
    )
  );

create policy "income_expense_location_scope"
  on public.income_expense for all to authenticated
  using (private.can_access_location(location_id))
  with check (private.can_access_location(location_id));

-- OCR.
create policy "ocr_tickets_location_scope"
  on public.ocr_tickets for all to authenticated
  using (private.can_access_location(location_id))
  with check (private.can_access_location(location_id));

-- Transport staff: NULL location is visible only to super admin.
create policy "transport_staffs_location_scope"
  on public.transport_staffs for all to authenticated
  using (private.can_access_optional_location(default_location_id))
  with check (private.can_access_optional_location(default_location_id));

create policy "transport_staff_contacts_parent_scope"
  on public.transport_staff_contacts for all to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  );

create policy "transport_staff_bank_accounts_parent_scope"
  on public.transport_staff_bank_accounts for all to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  );

create policy "transport_staff_plates_parent_scope"
  on public.transport_staff_plates for all to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and private.can_access_optional_location(s.default_location_id)
    )
  );

-- Money transfers.
create policy "money_transfers_location_scope"
  on public.money_transfers for all to authenticated
  using (private.can_access_location(location_id))
  with check (private.can_access_location(location_id));

create policy "money_transfer_slips_parent_scope"
  on public.money_transfer_slips for all to authenticated
  using (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

create policy "money_transfer_items_parent_scope"
  on public.money_transfer_items for all to authenticated
  using (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  )
  with check (
    exists (
      select 1
      from public.money_transfers t
      where t.id = transfer_id
        and private.can_access_location(t.location_id)
    )
  );

-- Sync/audit data. A NULL location is private to its actor unless super admin.
create policy "offline_sync_events_actor_scope"
  on public.offline_sync_events for all to authenticated
  using (
    private.is_super_admin()
    or (
      private.is_active_user()
      and (
        private.can_access_location(location_id)
        or (location_id is null and created_by_user_id = auth.uid())
      )
    )
  )
  with check (
    private.is_super_admin()
    or (
      private.is_active_user()
      and created_by_user_id = auth.uid()
      and (
        private.can_access_location(location_id)
        or location_id is null
      )
    )
  );

create policy "audit_logs_select_scope"
  on public.audit_logs for select to authenticated
  using (
    private.is_super_admin()
    or (
      private.is_active_user()
      and (
        private.can_access_location(location_id)
        or (location_id is null and actor_user_id = auth.uid())
      )
    )
  );

create policy "audit_logs_insert_scope"
  on public.audit_logs for insert to authenticated
  with check (
    private.is_super_admin()
    or (
      private.is_active_user()
      and actor_user_id = auth.uid()
      and (
        private.can_access_location(location_id)
        or location_id is null
      )
    )
  );
