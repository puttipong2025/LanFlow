-- Legacy transport staff imports predate branch scoping and have no
-- default_location_id. Keep writes branch-scoped, but allow active users to
-- read these central records for the transport staff list and transfer picker.

create policy "transport_staffs_select_legacy_global"
  on public.transport_staffs for select to authenticated
  using (default_location_id is null and private.is_active_user());

create policy "transport_staff_contacts_select_legacy_global"
  on public.transport_staff_contacts for select to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and s.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "transport_staff_bank_accounts_select_legacy_global"
  on public.transport_staff_bank_accounts for select to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and s.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "transport_staff_plates_select_legacy_global"
  on public.transport_staff_plates for select to authenticated
  using (
    exists (
      select 1
      from public.transport_staffs s
      where s.id = staff_id
        and s.default_location_id is null
        and private.is_active_user()
    )
  );
