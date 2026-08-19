-- Deletion audit history contains cross-document operational metadata and is
-- intentionally visible only to system managers. Document write guards stay unchanged.

drop policy if exists document_deletion_audits_select_scope
  on public.document_deletion_audits;

create policy document_deletion_audits_select_manager_only
  on public.document_deletion_audits
  for select
  to authenticated
  using (
    private.can_delete_reports()
    and private.can_manage_reports(location_id)
  );

notify pgrst, 'reload schema';
