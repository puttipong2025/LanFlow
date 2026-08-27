import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const password = process.env.TEST_PASSWORD || "password123";

test("concurrent OCR branch saves accept exactly one active parent", async () => {
  test.skip(!serviceRoleKey || !publishableKey, "Supabase test keys are required");
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect((await client.auth.signInWithPassword({ phone: "+66800000000", password })).error).toBeNull();

  const { data: location, error: locationError } = await service
    .from("locations")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  expect(locationError).toBeNull();

  const transferIds = [crypto.randomUUID(), crypto.randomUUID()];
  const slipIds = [crypto.randomUUID(), crypto.randomUUID()];
  const reference = `OCR-CONCURRENT-${crypto.randomUUID()}`;
  const payload = (index: number) => ({
    id: transferIds[index],
    clientTempId: transferIds[index],
    idempotencyKey: `branch-concurrent:${transferIds[index]}`,
    locationId: location!.id,
    targetLocationId: location!.id,
    operation: "create",
    transferType: "branch",
    revisionNo: 0,
    slips: [{
      id: slipIds[index],
      inputMethod: "ocr",
      referenceNumber: reference,
      amount: 1234.56,
      fee: 12,
      transactionDate: "2026-08-27T03:30:00.000Z",
      sortOrder: 0,
    }],
    items: [],
  });

  try {
    const results = await Promise.all([
      client.rpc("save_money_transfer", { p_payload: payload(0) }),
      client.rpc("save_money_transfer", { p_payload: payload(1) }),
    ]);
    const successes = results.filter((result) => result.error === null);
    const failures = results.filter((result) => result.error !== null);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error?.message).toContain("MT_OCR_DUPLICATE");
  } finally {
    await service.from("money_transfer_slips").delete().in("transfer_id", transferIds);
    await service.from("money_transfers").delete().in("id", transferIds);
  }
});
