import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function client() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInContext(browser: Browser, phone: string, password: string): Promise<BrowserContext> {
  const cookieValues = new Map<string, string>();
  const auth = createBrowserClient(supabaseUrl, publishableKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [],
      setAll: (cookies: Array<{ name: string; value: string }>) => {
        for (const cookie of cookies) cookieValues.set(cookie.name, cookie.value);
      },
    },
  });
  const signedIn = await auth.auth.signInWithPassword({ phone, password });
  expect(signedIn.error).toBeNull();
  return browser.newContext({
    storageState: {
      cookies: [...cookieValues].map(([name, value]) => ({
        name,
        value,
        domain: "127.0.0.1",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      })),
      origins: [],
    },
  });
}

test("self password change keeps this browser session and revokes the other refresh session", async ({ browser }) => {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = crypto.randomUUID();
  const localPhone = `07${Date.now().toString().slice(-8)}`;
  const phone = `+66${localPhone.slice(1)}`;
  const oldPassword = `Old-${crypto.randomUUID()}`;
  const newPassword = `New-${crypto.randomUUID()}`;
  const initialPasswordVersion = crypto.randomUUID();
  let currentContext: BrowserContext | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      id,
      phone,
      phone_confirm: true,
      password: oldPassword,
      user_metadata: { lanflow_password_copy_version: initialPasswordVersion },
    });
    expect(created.error).toBeNull();
    expect((await admin.from("profiles").insert({
      id,
      phone: localPhone,
      name: "Self password test",
      role: "user",
      is_active: true,
      password_hash: null,
      current_password_plaintext: oldPassword,
      current_password_auth_version: initialPasswordVersion,
    })).error).toBeNull();

    currentContext = await signedInContext(browser, phone, oldPassword);
    const otherDevice = client();
    const otherSignIn = await otherDevice.auth.signInWithPassword({ phone, password: oldPassword });
    expect(otherSignIn.error).toBeNull();
    const otherRefreshToken = otherSignIn.data.session!.refresh_token;

    const malformedBody = await currentContext.request.post("/api/auth/password", {
      data: [],
    });
    expect(malformedBody.status()).toBe(400);
    expect(await malformedBody.json()).toEqual({ errorMessage: "ข้อมูลเปลี่ยนรหัสผ่านไม่ถูกต้อง" });

    const wrongCurrent = await currentContext.request.post("/api/auth/password", {
      data: {
        currentPassword: `${oldPassword}-wrong`,
        newPassword,
        confirmPassword: newPassword,
      },
    });
    expect(wrongCurrent.status()).toBe(400);

    const changed = await currentContext.request.post("/api/auth/password", {
      data: {
        currentPassword: oldPassword,
        newPassword,
        confirmPassword: newPassword,
      },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
    expect(await changed.json()).toEqual({ success: true, readablePasswordAvailable: true });

    const currentMe = await currentContext.request.get("/api/auth/me");
    expect(currentMe.ok(), await currentMe.text()).toBeTruthy();
    expect((await otherDevice.auth.refreshSession({ refresh_token: otherRefreshToken })).error).not.toBeNull();

    expect((await client().auth.signInWithPassword({ phone, password: oldPassword })).error).not.toBeNull();
    expect((await client().auth.signInWithPassword({ phone, password: newPassword })).error).toBeNull();

    const stored = await admin
      .from("profiles")
      .select("current_password_plaintext, current_password_auth_version")
      .eq("id", id)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data?.current_password_plaintext).toBe(newPassword);
    const authUser = await admin.auth.admin.getUserById(id);
    expect(authUser.error).toBeNull();
    expect(stored.data?.current_password_auth_version)
      .toBe(authUser.data.user?.user_metadata?.lanflow_password_copy_version);
  } finally {
    await currentContext?.close();
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
});
