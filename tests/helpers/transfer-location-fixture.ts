import { createClient } from "@supabase/supabase-js";

export function createTransferLocationFixture(label: string) {
  const locationId = crypto.randomUUID();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55421";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const superAdminId = process.env.TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001";
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function requireSuccess(operation: PromiseLike<{ error: unknown }>) {
    const { error } = await operation;
    if (error) throw error;
  }

  return {
    locationId,
    async setup() {
      if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
      await requireSuccess(service.from("locations").insert({
        id: locationId,
        name: `${label} ${locationId.slice(0, 6)}`,
        code: `TF${locationId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        is_active: true,
      }));
      await requireSuccess(service.from("user_locations").insert({
        user_id: superAdminId,
        location_id: locationId,
        is_primary: false,
      }));
    },
    async cleanup() {
      await requireSuccess(service
        .from("cash_transfer_delete_requests")
        .delete()
        .or(`source_location_id.eq.${locationId},target_location_id.eq.${locationId}`));
      await requireSuccess(service
        .from("money_transfers")
        .delete()
        .or(`location_id.eq.${locationId},target_location_id.eq.${locationId}`));
      await requireSuccess(service.from("user_locations").delete().eq("location_id", locationId));
      await requireSuccess(service.from("locations").delete().eq("id", locationId));
    },
  };
}
