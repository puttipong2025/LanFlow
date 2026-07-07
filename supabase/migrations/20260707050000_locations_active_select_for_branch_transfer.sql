-- Branch transfer only requires source-branch permission, so users need to see
-- active target branches in the dropdown even when they are not assigned there.

create policy "locations_select_active_for_branch_transfer"
  on public.locations for select to authenticated
  using (is_active = true);
