import type { QueryClient } from "@tanstack/react-query";

export async function invalidatePaymentLocations(
  queryClient: QueryClient,
  ownerUserId: string,
  locationIds: Array<string | null | undefined>,
) {
  const { invalidateMoneyFlowLocations } = await import("@/lib/money-flow/invalidation");
  await invalidateMoneyFlowLocations(queryClient, ownerUserId, locationIds);
}
