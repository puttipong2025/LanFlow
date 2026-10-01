import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkUniqueIds } from "@/lib/server/chunk-ids";
import { readAllSupabaseRows } from "@/lib/supabase-pages";

type PendingAdjustmentRow = {
  profile_id: string;
  parent_debt_id: string | null;
};

export async function readActionablePendingAdjustments(supabase: SupabaseClient) {
  const adjustments = await readAllSupabaseRows((from, to) => supabase
    .from("financial_transactions")
    .select("profile_id, parent_debt_id")
    .eq("type", "ADJUSTMENT")
    .eq("status", "PENDING")
    .is("cancelled_at", null)
    .order("id", { ascending: true })
    .range(from, to)) as PendingAdjustmentRow[];
  const parentChunks = await Promise.all(
    chunkUniqueIds(adjustments.flatMap((item) => item.parent_debt_id ? [item.parent_debt_id] : []))
      .map(async (ids) => {
        const parents = await supabase
          .from("financial_transactions")
          .select("id")
          .in("id", ids)
          .eq("type", "WITHDRAWAL")
          .eq("status", "APPROVED")
          .is("cancelled_at", null);
        if (parents.error) throw parents.error;
        return parents.data || [];
      }),
  );
  const liveParentIds = new Set(parentChunks.flat().map((parent) => parent.id));
  return adjustments
    .filter((item) => item.parent_debt_id && liveParentIds.has(item.parent_debt_id))
    .map((item) => ({ profile_id: item.profile_id }));
}
