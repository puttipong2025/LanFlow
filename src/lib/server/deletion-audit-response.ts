import type { DocumentDeletionAudit } from "@/types/deletion-audits";

export const deletionAuditColumns = `
  id, document_kind, document_no, location_id, previous_status,
  original_actor_name, deleted_by_name, deleted_at, locations(name)
`;

export function mapDeletionAuditRow(
  row: Record<string, any>,
): DocumentDeletionAudit {
  const location = Array.isArray(row.locations)
    ? row.locations[0]
    : row.locations;

  return {
    id: row.id,
    documentKind: row.document_kind,
    documentNo: row.document_no,
    locationId: row.location_id,
    locationName: location?.name ?? "",
    previousStatus: row.previous_status,
    originalActorName: row.original_actor_name,
    deletedByName: row.deleted_by_name,
    deletedAt: row.deleted_at,
  };
}
