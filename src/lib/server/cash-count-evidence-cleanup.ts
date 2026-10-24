import { createSupabaseAdminClient } from "./supabase-admin";
import { deleteUnusedPrivateDriveImage } from "./google-drive";

// Retry cleanup on subsequent count actions. Never remove evidence attached to a count,
// including deleted counts, or an active session which may still be submitting.
export async function cleanupUnusedCashCountEvidence(ownerId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("cash_count_bank_evidence")
    .select("id,drive_file_id,upload_started_at,cash_count_sessions!inner(status)")
    .eq("owner_user_id", ownerId).is("count_id", null)
    .neq("cash_count_sessions.status", "active")
    .or(`upload_started_at.is.null,upload_started_at.lt.${new Date(Date.now() - 120_000).toISOString()}`)
    .order("created_at").limit(20);
  if (error) return;
  for (const row of data ?? []) {
    const session = Array.isArray(row.cash_count_sessions) ? row.cash_count_sessions[0] : row.cash_count_sessions;
    // The terminal state was set under the branch fence, so a submission cannot
    // concurrently attach this evidence. The grace period exceeds upload timeout.
    if (!session || session.status === "active") continue;
    try {
      if (row.drive_file_id) await deleteUnusedPrivateDriveImage(row.drive_file_id);
      await admin.from("cash_count_bank_evidence").delete().eq("id", row.id).is("count_id", null);
    } catch { /* Kept for a later retry; not a failed business transaction. */ }
  }
}
