import { expect, test } from "@playwright/test";
import { NextRequest, NextResponse } from "next/server";
import { loadSourceModule } from "../helpers/load-source-module";
import { CashCountInputError, cashCountErrorResponse, cashCountUnavailableResponse } from "../../src/lib/server/cash-count-response";

const id = "cc310000-0000-4000-8000-000000000001";
const counts = { "1000": 0, "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "2": 0, "1": 0 };
const brokenAuth = async () => ({ ok: true, auth: { sub: id }, supabase: {
  rpc: async () => { throw new Error("private database connection diagnostic"); },
} });
test("multipart submit does not expose unexpected upload diagnostics", async () => {
  const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/route.ts", {
    "@/lib/server/auth": { requireAuth: brokenAuth },
    "@/lib/server/submit-cash-count": { prepareCashCountSubmission: async () => { throw new Error("private Drive credential diagnostic"); } },
    "@/lib/server/cash-count-evidence-cleanup": {},
  });
  const response = await route.POST(new Request("http://localhost", { method: "POST", body: new FormData() }));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private Drive");
});
test("submit preserves safe multipart validation and rejects malformed JSON", async () => {
  const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/route.ts", {
    "@/lib/server/auth": { requireAuth: brokenAuth },
    "@/lib/server/cash-count-response": { CashCountInputError, cashCountErrorResponse, cashCountUnavailableResponse },
    "@/lib/server/submit-cash-count": { prepareCashCountSubmission: async () => { throw new CashCountInputError("รูปไม่ตรงกับผล OCR กรุณาถ่ายใหม่"); } },
    "@/lib/server/cash-count-evidence-cleanup": {},
  });
  const multipart = await route.POST(new Request("http://localhost", { method: "POST", body: new FormData() }));
  expect(multipart.status).toBe(400);
  expect((await multipart.json()).error).toContain("รูปไม่ตรง");
  const json = await route.POST(new Request("http://localhost", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } }));
  expect(json.status).toBe(400);
  expect((await json.json()).error).toBe("ข้อมูลตรวจนับไม่ถูกต้อง");
});
test("OCR hides unexpected diagnostics and handles auth transport failures", async () => {
  for (const authFails of [false, true]) {
    const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/ocr/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => {
        if (authFails) throw new Error("private auth diagnostic");
        return { ok: true, auth: { sub: id } };
      } },
      "@/lib/server/supabase-admin": {},
      "@/lib/server/cash-count-bank-ocr": {},
    });
    const request = new Request("http://localhost", { method: "POST" });
    request.formData = async () => { throw new Error("private parser diagnostic"); };
    const response = await route.POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private");
  }
});
test("OCR preserves safe validation feedback and role denial", async () => {
  for (const denied of [false, true]) {
    const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/ocr/route.ts", {
      "@/lib/server/auth": { requireAuth: async () => denied
        ? { ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) }
        : { ok: true, auth: { sub: id } } },
      "@/lib/server/supabase-admin": {}, "@/lib/server/cash-count-bank-ocr": {},
    });
    const response = await route.POST(new Request("http://localhost", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(denied ? 403 : 422);
    if (!denied) {
      expect((await response.json()).error).toBe("ช่องบัญชีไม่ถูกต้อง");
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
  }
});
for (const method of ["GET", "POST", "DELETE"] as const) {
  test(`count group ${method} returns private JSON when transport throws`, async () => {
    const route = loadSourceModule<Record<string, (request: Request) => Promise<Response>>>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
      "@/lib/server/auth": { requireSystemManager: brokenAuth },
    });
    const response = await route[method](new Request(`http://localhost/?id=${id}`, { method,
      ...(method === "POST" ? { body: JSON.stringify({ dueDays: 2, locationIds: [id] }), headers: { "Content-Type": "application/json" } } : {}),
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
}
test("count submit returns JSON rather than rejecting when RPC transport throws", async () => {
  const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/route.ts", {
    "@/lib/server/auth": { requireAuth: brokenAuth },
    "@/lib/server/submit-cash-count": {}, "@/lib/server/cash-count-evidence-cleanup": {},
  });
  const response = await route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ sessionId: id, actualCounts: counts }), headers: { "Content-Type": "application/json" } }));
  expect(response.status).toBe(503); expect((await response.json()).error).toBeTruthy();
});
test("session read returns JSON when transport throws", async () => {
  const route = loadSourceModule<{ GET: (request: NextRequest) => Promise<Response> }>("src/app/api/lanflow/cash-counts/session/route.ts", {
    "@/lib/server/auth": { requireAuth: brokenAuth }, "@/lib/server/cash-count-evidence-cleanup": {},
  });
  const response = await route.GET(new NextRequest(`http://localhost?locationId=${id}`));
  expect(response.status).toBe(503);
});
test("image route distinguishes a database outage from a missing count", async () => {
  const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: null, error: { message: "connection lost" } }) };
  const route = loadSourceModule<{ GET: (request: Request, context: { params: Promise<{ countId: string }> }) => Promise<Response> }>("src/app/api/lanflow/cash-counts/[countId]/image/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { from: () => query } }) },
    "@/lib/server/supabase-admin": {}, "@/lib/server/google-drive": {},
  });
  const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ countId: id }) });
  expect(response.status).toBe(503);
});

test("successful submission does not wait for remote unused-file cleanup", async () => {
  const tasks: Array<() => Promise<void>> = [];
  let cleanupStarted = false;
  const cleanup = () => { cleanupStarted = true; return new Promise<void>(() => undefined); };
  const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/route.ts", {
    "next/server": { NextResponse, after: (task: () => Promise<void>) => tasks.push(task) },
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { sub: id }, supabase: { rpc: async () => ({ data: { id: "saved" }, error: null }) } }) },
    "@/lib/server/submit-cash-count": {}, "@/lib/server/cash-count-evidence-cleanup": { cleanupUnusedCashCountEvidence: cleanup },
  });
  const request = new Request("http://localhost", { method: "POST", body: JSON.stringify({ sessionId: id, actualCounts: counts }), headers: { "Content-Type": "application/json" } });
  const response = route.POST(request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cleanupStarted).toBe(false);
  expect((await response).status).toBe(201);
  expect(tasks).toHaveLength(1);
});

test("image 404 still means a genuinely missing count", async () => {
  const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: null, error: null }) };
  const route = loadSourceModule<{ GET: (request: Request, context: { params: Promise<{ countId: string }> }) => Promise<Response> }>("src/app/api/lanflow/cash-counts/[countId]/image/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { from: () => query } }) },
    "@/lib/server/supabase-admin": {}, "@/lib/server/google-drive": {},
  });
  expect((await route.GET(new Request("http://localhost"), { params: Promise.resolve({ countId: id }) })).status).toBe(404);
});
test("error protection preserves role denial and valid input errors", async () => {
  const denied = loadSourceModule<{ GET: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) }) },
  });
  expect((await denied.GET(new Request("http://localhost"))).status).toBe(403);
  const invalid = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
    "@/lib/server/auth": { requireSystemManager: brokenAuth },
  });
  expect((await invalid.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ dueDays: 6, locationIds: [id] }) }))).status).toBe(400);
});
