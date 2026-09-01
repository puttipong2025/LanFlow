create or replace function private.can_access_business_modules()
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
      and p.role in ('admin', 'super_admin')
  )
$$;

revoke all on function private.can_access_business_modules() from public;
grant execute on function private.can_access_business_modules() to authenticated, service_role;

create or replace function private.can_access_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_business_modules()
    and (
      private.can_access_super_admin_features()
      or (
        target_location is not null
        and exists (
          select 1
          from public.user_locations ul
          where ul.user_id = auth.uid()
            and ul.location_id = target_location
        )
      )
    )
$$;

create or replace function public.get_my_active_location_assignments()
returns table(location_id uuid, is_primary boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select ul.location_id, ul.is_primary
  from public.user_locations ul
  join public.locations l on l.id = ul.location_id and l.is_active = true
  join public.profiles p on p.id = ul.user_id and p.is_active = true
  where ul.user_id = auth.uid()
  order by ul.is_primary desc, ul.created_at, ul.id
$$;

revoke all on function public.get_my_active_location_assignments() from public;
grant execute on function public.get_my_active_location_assignments() to authenticated, service_role;

-- This helper is an implementation detail of the manager-only approval RPC.
-- Keeping a direct client grant adds an unnecessary privileged-function surface.
revoke execute on function public.create_stock_product_with_sale_item(jsonb) from authenticated;

create or replace function private.enforce_business_module_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.can_access_business_modules() then
    raise exception 'Business module access denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_business_module_write() from public;

drop trigger if exists enforce_stock_product_approval_business_access
  on public.stock_product_approval_requests;
create trigger enforce_stock_product_approval_business_access
before insert or update on public.stock_product_approval_requests
for each row execute function private.enforce_business_module_write();

alter policy "Allow all authenticated users to read active items"
  on public.income_sale_items
  using (is_active = true and private.can_access_business_modules());

alter policy "acid_products_active_read"
  on public.stock_products
  using (is_active = true and private.can_access_business_modules());

alter policy "active users read rubber bill approval settings"
  on public.rubber_bill_approval_settings
  using (private.can_access_business_modules());

alter policy "cash transfer delete requests read"
  on public.cash_transfer_delete_requests
  using (
    private.can_access_business_modules()
    and (
      private.can_access_super_admin_features()
      or requested_by_user_id = auth.uid()
      or private.can_access_location(source_location_id)
    )
  );

alter policy "customer_bank_accounts_select_legacy_global"
  on public.customer_bank_accounts
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.customers c
      where c.id = customer_bank_accounts.customer_id
        and c.default_location_id is null
    )
  );

alter policy "customer_contacts_select_legacy_global"
  on public.customer_contacts
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.customers c
      where c.id = customer_contacts.customer_id
        and c.default_location_id is null
    )
  );

alter policy "customer_farms_select_legacy_global"
  on public.customer_farms
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.customers c
      where c.id = customer_farms.customer_id
        and c.default_location_id is null
    )
  );

alter policy "customers_select_legacy_global"
  on public.customers
  using (default_location_id is null and private.can_access_business_modules());

alter policy "income_expense_approval_keywords_read"
  on public.income_expense_approval_keywords
  using (is_active = true and private.can_access_business_modules());

alter policy "income_expense_approval_requests_read"
  on public.income_expense_approval_requests
  using (
    private.can_access_business_modules()
    and (
      public.can_access_super_admin_features()
      or requested_by_user_id = auth.uid()
      or public.can_access_location(location_id)
    )
  );

alter policy "income_expense_approval_settings_read"
  on public.income_expense_approval_settings
  using (private.can_access_business_modules());

alter policy "locations_select_active_for_branch_transfer"
  on public.locations
  using (is_active = true and private.can_access_business_modules());

alter policy "stock_entry_approval_requests_read"
  on public.stock_entry_approval_requests
  using (
    private.can_access_business_modules()
    and (
      public.can_access_super_admin_features()
      or requested_by_user_id = auth.uid()
      or public.can_access_location(location_id)
      or (target_location_id is not null and public.can_access_location(target_location_id))
    )
  );

alter policy "stock_product_approval_requests_read"
  on public.stock_product_approval_requests
  using (
    private.can_access_business_modules()
    and (
      public.can_access_super_admin_features()
      or requested_by_user_id = auth.uid()
    )
  );

alter policy "transport_staff_bank_accounts_select_legacy_global"
  on public.transport_staff_bank_accounts
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.transport_staffs s
      where s.id = transport_staff_bank_accounts.staff_id
        and s.default_location_id is null
    )
  );

alter policy "transport_staff_contacts_select_legacy_global"
  on public.transport_staff_contacts
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.transport_staffs s
      where s.id = transport_staff_contacts.staff_id
        and s.default_location_id is null
    )
  );

alter policy "transport_staff_plates_select_legacy_global"
  on public.transport_staff_plates
  using (
    private.can_access_business_modules()
    and exists (
      select 1 from public.transport_staffs s
      where s.id = transport_staff_plates.staff_id
        and s.default_location_id is null
    )
  );

alter policy "transport_staffs_select_legacy_global"
  on public.transport_staffs
  using (default_location_id is null and private.can_access_business_modules());
