export type DocumentDeletionAuditKind =
  | "report_batch"
  | "rubber_export"
  | "cash_count";

export type DocumentDeletionAudit = {
  id: string;
  documentKind: DocumentDeletionAuditKind;
  documentNo: string;
  locationId: string;
  locationName: string;
  previousStatus: "draft" | "verified" | null;
  originalActorName: string | null;
  deletedByName: string;
  deletedAt: string;
};
