import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const password = process.env.TEST_PASSWORD || "password123";

async function managerClient() {
  expect(publishableKey).toBeTruthy();
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const testPhone = process.env.TEST_PHONE || "0800000000";
  const { error } = await client.auth.signInWithPassword({
    phone: testPhone.startsWith("+") ? testPhone : `+66${testPhone.slice(1)}`,
    password,
  });
  expect(error).toBeNull();
  return client;
}

test.describe("Retired TIMER compatibility @time-tracking", () => {
  test("freezes the database mode to EXCEPTIONS without deleting historical segments", async () => {
    const manager = await managerClient();

    const settings = await manager.rpc("get_time_payroll_settings");
    expect(settings.error).toBeNull();
    expect(settings.data).toMatchObject({ mode: "EXCEPTIONS" });
    expect(settings.data?.activatedOn).toBeTruthy();

    const history = await manager
      .from("time_segments")
      .select("id", { count: "exact", head: true });
    expect(history.error).toBeNull();
    expect(history.count).not.toBeNull();
  });

  test("allows authenticated legacy reads but rejects every legacy TIMER writer", async () => {
    const manager = await managerClient();
    const auth = await manager.auth.getUser();
    expect(auth.error).toBeNull();
    expect(auth.data.user).toBeTruthy();
    const profileId = auth.data.user!.id;

    const legacyRead = await manager
      .from("time_segments")
      .select("id, start_time, end_time")
      .limit(1);
    expect(legacyRead.error).toBeNull();

    const calls = await Promise.all([
      manager.rpc("set_time_tracking_status", {
        p_profile_id: profileId,
        p_status: "RUNNING",
      }),
      manager.rpc("cutoff_time_tracking", {
        p_profile_id: profileId,
        p_cutoff_time: new Date().toISOString(),
      }),
      manager.rpc("replace_time_tracking_segments", {
        p_profile_id: profileId,
        p_selections: [],
        p_full_snapshot: {},
        p_comment: "must be rejected",
      }),
      manager.rpc("activate_exception_attendance"),
      manager.rpc("get_time_payroll_preflight"),
    ]);

    for (const result of calls) {
      expect(result.error?.message).toContain("permission denied for function");
    }
  });

  test("keeps legacy tables read-only for authenticated clients", async () => {
    const manager = await managerClient();
    const auth = await manager.auth.getUser();
    expect(auth.data.user).toBeTruthy();

    const insertAttempt = await manager
      .from("time_segments")
      .insert({ profile_id: auth.data.user!.id, start_time: new Date().toISOString() });
    expect(insertAttempt.error).toBeTruthy();

    const resumeAttempt = await manager
      .from("time_tracking_resume_schedules")
      .insert({
        profile_id: auth.data.user!.id,
        payroll_slip_id: "00000000-0000-0000-0000-000000000000",
        resume_at: new Date().toISOString(),
      });
    expect(resumeAttempt.error).toBeTruthy();
  });
});
