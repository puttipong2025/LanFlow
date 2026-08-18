import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

type MoneyTransferSourceType = "rubber_bill" | "ocr_ticket";

export function useMoneyTransferSourceLocks(
  locationId: string,
  sourceType: MoneyTransferSourceType,
  sourceIds: string[],
) {
  const normalizedSourceIds = useMemo(
    () => [...new Set(sourceIds)].sort(),
    [sourceIds],
  );
  const sourceIdsKey = normalizedSourceIds.join(",");
  const query = useQuery({
    queryKey: [
      ...moneyFlowQueryKeys.moneyTransferSourceLocks(locationId, sourceType),
      sourceIdsKey,
    ],
    enabled: Boolean(locationId) && normalizedSourceIds.length > 0,
    queryFn: async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_money_transfer_source_locks", {
        p_location_id: locationId,
        p_source_type: sourceType,
        p_source_ids: normalizedSourceIds,
      });
      if (error) throw new Error(error.message);
      return new Map(
        ((data ?? []) as Array<{ source_id: string; transfer_id: string }>).map((row) => [
          row.source_id,
          row.transfer_id,
        ]),
      );
    },
  });

  return {
    lockedSourceIds: new Set(query.data?.keys() ?? []),
    transferIdBySourceId: query.data ?? new Map<string, string>(),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
