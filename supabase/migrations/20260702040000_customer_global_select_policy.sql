-- Legacy customer imports predate branch scoping and have no default_location_id.
-- Keep writes branch-scoped, but allow authenticated active users to read these
-- central customer records so autocomplete works for non-super-admin roles.

create policy "customers_select_legacy_global"
  on public.customers for select to authenticated
  using (default_location_id is null and private.is_active_user());

create policy "customer_contacts_select_legacy_global"
  on public.customer_contacts for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "customer_bank_accounts_select_legacy_global"
  on public.customer_bank_accounts for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "customer_farms_select_legacy_global"
  on public.customer_farms for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );
