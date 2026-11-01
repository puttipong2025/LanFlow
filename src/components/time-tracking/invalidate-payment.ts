import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";

export async function invalidatePaymentLocations(
  queryClient: QueryClient,
  ownerUserId: string,
  locationIds: Array<string | null | undefined>,
) {
  try {
    const { invalidateMoneyFlowLocations } = await import("@/lib/money-flow/invalidation");
    await invalidateMoneyFlowLocations(queryClient, ownerUserId, locationIds);
  } catch {
    toast.error("บันทึกแล้ว แต่โหลดข้อมูลการเงินล่าสุดไม่ได้ กรุณาลองโหลดใหม่");
  }
}
