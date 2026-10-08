import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { loadSourceModule } from "./helpers/load-source-module";

const locationId = "71000000-0000-4000-8000-000000000021";
const groupId = "71000000-0000-4000-8000-000000000022";
const otherLocationId = "71000000-0000-4000-8000-000000000023";
const caseVariantLocationId = "7a000000-0000-4000-8000-000000000021";
const caseVariantGroupId = "7b000000-0000-4000-8000-000000000022";
const caseVariantSourceGroupId = "7c000000-0000-4000-8000-000000000023";

const effectiveSettings = {
  locationId,
  groupId: null,
  ruleSource: "ungrouped",
  editWindowMinutes: 30,
  centralPrice: 42,
  priceAllowance: 1,
  effectivePriceCap: 43,
  priceRuleRevision: 1,
  nonCurrentDateRequiresApproval: false,
  updatedByName: "System",
  updatedByPhone: null,
  updatedAt: "2026-10-05T00:00:00.000Z",
};

function approvalGroupsResponse(centralPrice: number) {
  return {
    groups: [],
    availableLocationIds: [locationId],
    centralPrice: {
      value: centralPrice,
      revision: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
    ungroupedDefaults: {
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revision: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
    maxPriceAllowance: {
      value: 10,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
  };
}

function routeDependencies(data: unknown) {
  const supabase = { rpc: async () => ({ data, error: null }) };
  return {
    "@/lib/server/auth": {
      requireAuth: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
      requireSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
      requireRole: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
    },
  };
}

function rpcErrorRouteDependencies(message: string, code: string) {
  const supabase = { rpc: async () => ({ data: null, error: { code, message }, status: 400 }) };
  return {
    "@/lib/server/auth": {
      requireSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
    },
  };
}

function transportFailingSupabaseClient() {
  return createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async () => {
        throw new Error("synthetic transport failure");
      },
    },
  });
}

test("installed Supabase RPC resolves transport failures through its error result", async () => {
  const client = transportFailingSupabaseClient();

  const result = await client.rpc("synthetic_rpc");

  expect(result.data).toBeNull();
  expect(result.status).toBe(0);
  expect(result.error?.message).toContain("synthetic transport failure");
});

function authFailureRouteDependencies() {
  return {
    "@/lib/server/auth": {
      requireSystemManager: async () => ({
        ok: false,
        response: Response.json(
          { error: "ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ" },
          { status: 401 },
        ),
      }),
    },
  };
}

function sequencedRouteDependencies(dataByCall: unknown[]) {
  let callIndex = 0;
  const supabase = {
    rpc: async () => ({
      data: dataByCall[callIndex++],
      error: null,
    }),
  };
  return {
    "@/lib/server/auth": {
      requireSystemManager: async () => ({
        ok: true,
        auth: { role: "super_admin" },
        supabase,
      }),
    },
  };
}

test("rubber approval group list rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(null),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects incomplete nested settings", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies({
      groups: [],
      availableLocationIds: [],
      centralPrice: {},
      ungroupedDefaults: {},
      maxPriceAllowance: {},
    }),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects a zero central price", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(approvalGroupsResponse(0)),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects a timestamp that would crash the policy UI", async () => {
  const payload = approvalGroupsResponse(42);
  payload.centralPrice.updatedAt = "not-a-date";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects a non-ISO timestamp accepted by Date.parse", async () => {
  const payload = approvalGroupsResponse(42);
  payload.centralPrice.updatedAt = "0";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects mismatched ungrouped location sets", async () => {
  const payload = approvalGroupsResponse(42);
  payload.ungroupedDefaults.locationIds = [otherLocationId];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects an allowance above the global maximum", async () => {
  const payload = approvalGroupsResponse(42);
  payload.ungroupedDefaults.priceAllowance = 11;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects a central-plus-maximum value outside numeric(12,2)", async () => {
  const payload = approvalGroupsResponse(9_999_999_999.99);
  payload.maxPriceAllowance.value = 0.01;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list preserves a central-plus-maximum value at the numeric(12,2) boundary", async () => {
  const payload = approvalGroupsResponse(9_999_999_999.98);
  payload.maxPriceAllowance.value = 0.01;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject(payload);
});

test("rubber approval group list rejects a branch in both a group and the ungrouped set", async () => {
  const payload = {
    ...approvalGroupsResponse(42),
    groups: [{
      id: groupId,
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    }],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group list rejects an empty persisted group", async () => {
  const payload = {
    ...approvalGroupsResponse(42),
    groups: [{
      id: groupId,
      locationIds: [],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    }],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );

  const response = await route.GET(new Request("http://local/api/lanflow/rubber-bills/approval-groups") as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" });
});

test("rubber approval group create rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(null),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 0 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการสร้างกลุ่ม" });
});

test("rubber approval group create rejects a response for different branches", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [otherLocationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 1,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [otherLocationId],
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 0 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการสร้างกลุ่ม" });
});

test("rubber approval group create rejects mismatched affected branches", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [locationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 1,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [otherLocationId],
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 0 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการสร้างกลุ่ม" });
});

test("rubber approval group create rejects an impossible initial revision", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [locationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 7,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [locationId],
    }),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationIds: [locationId], editWindowMinutes: 30, priceAllowance: 0 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการสร้างกลุ่ม" });
});

test("rubber approval group create canonicalizes UUID casing before validating the response", async () => {
  const payload = {
    group: {
      id: groupId,
      locationIds: [caseVariantLocationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
    affectedLocationIds: [caseVariantLocationId],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(payload),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [caseVariantLocationId.toUpperCase()],
      editWindowMinutes: 30,
      priceAllowance: 0,
    }),
  }) as never);

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(payload);
});

test("rubber approval group create rejects duplicate UUIDs that differ only by casing", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/route.ts",
    routeDependencies(null),
  );
  const response = await route.POST(new Request("http://local/api/lanflow/rubber-bills/approval-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [caseVariantLocationId, caseVariantLocationId.toUpperCase()],
      editWindowMinutes: 30,
      priceAllowance: 0,
    }),
  }) as never);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ",
  });
});

test("rubber central-price save rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/central/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/central/route.ts",
    routeDependencies(null),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/central", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ centralPrice: 42, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber central-price save rejects a response with a different price", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/central/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/central/route.ts",
    routeDependencies(approvalGroupsResponse(41)),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/central", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ centralPrice: 42, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber central-price save rejects an unrelated revision", async () => {
  const payload = approvalGroupsResponse(42);
  payload.centralPrice.revision = 7;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/central/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/central/route.ts",
    routeDependencies(payload),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/central", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ centralPrice: 42, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber approval group update rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies(null),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" });
});

test("rubber approval group update rejects a response for a different group", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies({
      group: {
        id: otherLocationId,
        locationIds: [locationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 2,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [locationId],
    }),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" });
});

test("rubber approval group update rejects affected branches that omit the saved group", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [locationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 2,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [otherLocationId],
    }),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" });
});

test("rubber approval group update preserves a valid unchanged response", async () => {
  const payload = {
    group: {
      id: groupId,
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
    affectedLocationIds: [],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies(payload),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
});

test("rubber approval group update rejects a response with different settings", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [locationId],
        editWindowMinutes: 15,
        priceAllowance: 1,
        revisionNo: 2,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [locationId],
    }),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" });
});

test("rubber approval group update rejects an unrelated revision", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies({
      group: {
        id: groupId,
        locationIds: [locationId],
        editWindowMinutes: 30,
        priceAllowance: 0,
        revisionNo: 7,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
      affectedLocationIds: [locationId],
    }),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {},
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" });
});

test("rubber approval group update canonicalizes path, member, and source-revision UUIDs", async () => {
  let rpcArguments: Record<string, unknown> | undefined;
  const payload = {
    group: {
      id: caseVariantGroupId,
      locationIds: [caseVariantLocationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 2,
      updatedByName: "System",
      updatedByPhone: null,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
    affectedLocationIds: [caseVariantLocationId],
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {
            rpc: async (_name: string, args: Record<string, unknown>) => {
              rpcArguments = args;
              return { data: payload, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${caseVariantGroupId.toUpperCase()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [caseVariantLocationId.toUpperCase()],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: { [caseVariantSourceGroupId.toUpperCase()]: 3 },
    }),
  }) as never, { params: Promise.resolve({ id: caseVariantGroupId.toUpperCase() }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
  expect(rpcArguments).toMatchObject({
    p_group_id: caseVariantGroupId,
    p_location_ids: [caseVariantLocationId],
    p_expected_source_revisions: { [caseVariantSourceGroupId]: 3 },
  });
});

test("rubber approval group update rejects duplicate source revisions with different casing", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies(null),
  );
  const response = await route.PUT(new Request(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationIds: [locationId],
      editWindowMinutes: 30,
      priceAllowance: 0,
      revisionNo: 1,
      sourceGroupRevisions: {
        [caseVariantSourceGroupId]: 3,
        [caseVariantSourceGroupId.toUpperCase()]: 3,
      },
    }),
  }) as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    errorMessage: "revision ของกลุ่มต้นทางไม่ถูกต้อง",
  });
});

test("rubber approval group delete rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies(null),
  );
  const request = {
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}?revision=1`),
  } as never;
  const response = await route.DELETE(request, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการลบกลุ่ม" });
});

test("rubber approval group delete rejects an empty released-branch result", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-groups/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-groups/[id]/route.ts",
    routeDependencies({ success: true, releasedLocationIds: [] }),
  );
  const request = {
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-groups/${groupId}?revision=1`),
  } as never;
  const response = await route.DELETE(request, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการลบกลุ่ม" });
});

test("rubber ungrouped-default save rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route.ts",
    routeDependencies(null),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/ungrouped", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editWindowMinutes: 30, priceAllowance: 0, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber ungrouped-default save rejects a response with different settings", async () => {
  const payload = approvalGroupsResponse(42);
  payload.ungroupedDefaults.editWindowMinutes = 15;
  payload.ungroupedDefaults.priceAllowance = 1;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route.ts",
    routeDependencies(payload),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/ungrouped", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editWindowMinutes: 30, priceAllowance: 0, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber ungrouped-default save rejects an unrelated revision", async () => {
  const payload = approvalGroupsResponse(42);
  payload.ungroupedDefaults.revision = 7;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/ungrouped/route.ts",
    routeDependencies(payload),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/ungrouped", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editWindowMinutes: 30, priceAllowance: 0, expectedRevision: 1 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber maximum-price save rejects a response with a different value", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
    routeDependencies({
      status: "saved",
      setting: {
        value: 11,
        updatedByName: "System",
        updatedByPhone: null,
        updatedAt: "2026-10-05T00:00:00.000Z",
      },
    }),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
  }) as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
});

test("rubber maximum-price save rejects malformed conflict contracts", async () => {
  const malformedConflicts = [
    {
      status: "conflict",
      code: "UNKNOWN_CONFLICT",
      errorMessage: "conflict",
      conflicts: [],
    },
    {
      status: "conflict",
      code: "RUBBER_ALLOWANCE_LIMIT_TOO_LOW",
      errorMessage: "conflict",
      conflicts: [{
        scope: "ungrouped",
        groupId,
        locationIds: [locationId],
        allowance: 11,
      }],
    },
  ];

  for (const conflict of malformedConflicts) {
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
      "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
      routeDependencies(conflict),
    );
    const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
    }) as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการบันทึก" });
  }
});

test("rubber maximum-price save preserves known actionable conflicts", async () => {
  const conflicts = [
    {
      status: "conflict" as const,
      code: "RUBBER_ALLOWANCE_STALE",
      errorMessage: "ราคายางที่กำหนดสูงสุดถูกแก้ไขโดยผู้ใช้อื่น",
      conflicts: [],
      expectedMessage: "ราคายางที่กำหนดสูงสุดถูกแก้ไขโดยผู้ใช้อื่น กรุณาตรวจสอบค่าล่าสุดและยืนยันอีกครั้ง",
    },
    {
      status: "conflict" as const,
      code: "RUBBER_ALLOWANCE_LIMIT_TOO_LOW",
      errorMessage: "ราคายางที่กำหนดสูงสุดต่ำกว่าค่าที่ใช้อยู่",
      conflicts: [{
        scope: "group",
        groupId,
        locationIds: [locationId],
        allowance: 11,
      }],
      expectedMessage: "ราคายางที่กำหนดสูงสุดต้องไม่น้อยกว่าค่าที่กลุ่มหรือสาขาที่ยังไม่จัดกลุ่มใช้อยู่",
    },
  ];

  for (const conflict of conflicts) {
    const { expectedMessage, ...rpcConflict } = conflict;
    const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
      "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
      routeDependencies(rpcConflict),
    );
    const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
    }) as never);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ...rpcConflict, errorMessage: expectedMessage });
  }
});

test("rubber maximum-price save replaces database details in a known conflict", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/max-price-allowance/route.ts",
    routeDependencies({
      status: "conflict",
      code: "RUBBER_ALLOWANCE_STALE",
      errorMessage: 'duplicate key value violates unique constraint "rubber_bill_approval_settings_pkey"',
      conflicts: [],
    }),
  );
  const response = await route.PUT(new Request("http://local/api/lanflow/rubber-bills/approval-settings/max-price-allowance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxPriceAllowance: 10, expectedMaxPriceAllowance: 9 }),
  }) as never);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    status: "conflict",
    code: "RUBBER_ALLOWANCE_STALE",
    errorMessage: "ราคายางที่กำหนดสูงสุดถูกแก้ไขโดยผู้ใช้อื่น กรุณาตรวจสอบค่าล่าสุดและยืนยันอีกครั้ง",
    conflicts: [],
  });
});

test("effective rubber approval settings GET rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    routeDependencies(null),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับการตั้งค่าตามรูปแบบที่กำหนด" });
});

test("effective rubber approval settings GET rejects a response for another location", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    routeDependencies({ ...effectiveSettings, locationId: otherLocationId }),
  );
  const response = await route.GET({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับการตั้งค่าตามรูปแบบที่กำหนด" });
});

test("effective rubber approval settings GET accepts PostgreSQL-canonical UUID casing", async () => {
  const payload = { ...effectiveSettings, locationId: caseVariantLocationId };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    routeDependencies(payload),
  );
  const response = await route.GET({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/approval-settings?locationId=${caseVariantLocationId.toUpperCase()}`,
    ),
  } as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
});

test("effective rubber approval settings PUT rejects a malformed post-save response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    sequencedRouteDependencies([effectiveSettings, null, null]),
  );
  const response = await route.PUT({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`),
    json: async () => ({ nonCurrentDateRequiresApproval: true }),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับการตั้งค่าตามรูปแบบที่กำหนด" });
});

test("effective rubber approval settings PUT rejects a post-save response with the previous date rule", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    sequencedRouteDependencies([effectiveSettings, true, effectiveSettings]),
  );
  const response = await route.PUT({
    nextUrl: new URL(`http://local/api/lanflow/rubber-bills/approval-settings?locationId=${locationId}`),
    json: async () => ({ nonCurrentDateRequiresApproval: true }),
  } as never);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับการตั้งค่าตามรูปแบบที่กำหนด" });
});

test("effective rubber approval settings PUT canonicalizes UUID casing across both reads", async () => {
  const current = { ...effectiveSettings, locationId: caseVariantLocationId };
  const saved = { ...current, nonCurrentDateRequiresApproval: true };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-settings/route")>(
    "src/app/api/lanflow/rubber-bills/approval-settings/route.ts",
    sequencedRouteDependencies([current, true, saved]),
  );
  const response = await route.PUT({
    nextUrl: new URL(
      `http://local/api/lanflow/rubber-bills/approval-settings?locationId=${caseVariantLocationId.toUpperCase()}`,
    ),
    json: async () => ({ nonCurrentDateRequiresApproval: true }),
  } as never);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(saved);
});

test("rubber approval request approve rejects a malformed request id before RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(null),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: "not-a-uuid" }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errorMessage: "รหัสคำขอไม่ถูกต้อง" });
});

test("rubber approval request approve preserves the actionable auth failure message", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    authFailureRouteDependencies(),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    errorMessage: "ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ",
  });
});

test("rubber approval request approve rejects a malformed RPC response", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(null),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" });
});

test("rubber approval request approve rejects a non-ISO server timestamp", async () => {
  const approved = {
    status: "approved",
    requestId: groupId,
    operation: "create",
    billId: otherLocationId,
    syncResult: {
      status: "synced",
      id: otherLocationId,
      serverBillNo: "RB-0001",
      revisionNo: 1,
      serverReceivedAt: "0",
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(approved),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" });
});

test("rubber approval request approve rejects a whitespace-only server bill number", async () => {
  const approved = {
    status: "approved",
    requestId: groupId,
    operation: "create",
    billId: otherLocationId,
    syncResult: {
      status: "synced",
      id: otherLocationId,
      serverBillNo: " ",
      revisionNo: 1,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(approved),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" });
});

test("rubber approval request approve rejects an impossible create revision", async () => {
  const approved = {
    status: "approved",
    requestId: groupId,
    operation: "create",
    billId: otherLocationId,
    syncResult: {
      status: "synced",
      id: otherLocationId,
      serverBillNo: "RB-0001",
      revisionNo: 7,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(approved),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" });
});

test("rubber approval request approve does not expose database error details", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    rpcErrorRouteDependencies("invalid input syntax for type uuid at internal_table", "22P02"),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "อนุมัติคำขอไม่สำเร็จ" });
});

test("rubber approval request approve keeps a raised business rejection as bad input", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    rpcErrorRouteDependencies("ไม่พบคำขอที่รออนุมัติ", "P0001"),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errorMessage: "อนุมัติคำขอไม่สำเร็จ" });
});

test("rubber approval request approve treats an internal approval failure as a server error", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    rpcErrorRouteDependencies("บันทึกบิลยางไม่สำเร็จ", "RB500"),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "อนุมัติคำขอไม่สำเร็จ" });
});

test("rubber approval request approve does not classify a transport failure as bad input", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: transportFailingSupabaseClient(),
        }),
      },
    },
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "อนุมัติคำขอไม่สำเร็จ" });
});

test("rubber approval request approve preserves a valid RPC response", async () => {
  const approved = {
    status: "approved",
    requestId: groupId,
    operation: "create",
    billId: otherLocationId,
    syncResult: {
      status: "synced",
      id: otherLocationId,
      serverBillNo: "RB-0001",
      revisionNo: 1,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    routeDependencies(approved),
  );
  const response = await route.POST({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(approved);
});

test("rubber approval request approve canonicalizes a valid uppercase request id", async () => {
  let rpcArguments: Record<string, unknown> | undefined;
  const approved = {
    status: "approved",
    requestId: caseVariantGroupId,
    operation: "create",
    billId: caseVariantLocationId,
    syncResult: {
      status: "synced",
      id: caseVariantLocationId,
      serverBillNo: "RB-0001",
      revisionNo: 1,
      serverReceivedAt: "2026-10-05T00:00:00.000Z",
    },
  };
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/approve/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {
            rpc: async (_name: string, args: Record<string, unknown>) => {
              rpcArguments = args;
              return { data: approved, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.POST({} as never, {
    params: Promise.resolve({ id: caseVariantGroupId.toUpperCase() }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(approved);
  expect(rpcArguments).toEqual({ p_request_id: caseVariantGroupId });
});

test("rubber approval request delete rejects a malformed request id before RPC", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/route.ts",
    routeDependencies(null),
  );
  const response = await route.DELETE({} as never, { params: Promise.resolve({ id: "not-a-uuid" }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errorMessage: "รหัสคำขอไม่ถูกต้อง" });
});

test("rubber approval request delete preserves the actionable auth failure message", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/route.ts",
    authFailureRouteDependencies(),
  );
  const response = await route.DELETE({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    errorMessage: "ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ",
  });
});

test("rubber approval request delete does not expose database error details", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/route.ts",
    rpcErrorRouteDependencies("relation private.secret_table does not exist", "42P01"),
  );
  const response = await route.DELETE({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ errorMessage: "ลบคำขอไม่สำเร็จ" });
});

test("rubber approval request delete keeps a raised business rejection as bad input", async () => {
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/route.ts",
    rpcErrorRouteDependencies("ไม่พบคำขอที่รออนุมัติ", "P0001"),
  );
  const response = await route.DELETE({} as never, { params: Promise.resolve({ id: groupId }) });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ errorMessage: "ลบคำขอไม่สำเร็จ" });
});

test("rubber approval request delete canonicalizes a valid uppercase request id", async () => {
  let rpcArguments: Record<string, unknown> | undefined;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/rubber-bills/approval-requests/[id]/route")>(
    "src/app/api/lanflow/rubber-bills/approval-requests/[id]/route.ts",
    {
      "@/lib/server/auth": {
        requireSystemManager: async () => ({
          ok: true,
          auth: { role: "super_admin" },
          supabase: {
            rpc: async (_name: string, args: Record<string, unknown>) => {
              rpcArguments = args;
              return { data: null, error: null };
            },
          },
        }),
      },
    },
  );
  const response = await route.DELETE({} as never, {
    params: Promise.resolve({ id: caseVariantGroupId.toUpperCase() }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "deleted",
    requestId: caseVariantGroupId,
  });
  expect(rpcArguments).toEqual({ p_request_id: caseVariantGroupId });
});
