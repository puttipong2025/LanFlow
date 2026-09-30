import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

async function context(browser: Browser, role: "user" | "admin" | "super_admin") {
  return browser.newContext({ storageState: `playwright/.auth/${role}.json` });
}

async function primaryLocationId(client: BrowserContext) {
  const response = await client.request.get("/api/auth/me");
  expect(response.ok()).toBe(true);
  return (await response.json() as { profile: { locationIds: string[] } }).profile.locationIds[0];
}

function cursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("payroll mutation routes reject null JSON bodies", async ({ browser }) => {
  const user = await context(browser, "user");
  const admin = await context(browser, "super_admin");
  try {
    for (const [client, path] of [
      [user, "/api/lanflow/time-tracking/user"],
      [admin, "/api/lanflow/time-tracking/admin"],
    ] as const) {
      const response = await client.request.post(path, {
        headers: { "Content-Type": "application/json" },
        data: null,
      });
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await Promise.all([user.close(), admin.close()]);
  }
});

test("time/payroll admin rejects malformed payloads before querying PostgreSQL", async ({ browser }) => {
  const admin = await context(browser, "super_admin");
  try {
    const [arrayPayload, malformedAuditAdmin, malformedApprovalComment] = await Promise.all([
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: { action: "GET_AUDIT_LOGS", payload: [] },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "GET_AUDIT_LOGS",
          payload: { admin_user_id: { malformed: true } },
        },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "APPROVE_TRANSACTION",
          payload: {
            transaction_id: crypto.randomUUID(),
            status: "REJECTED",
            admin_comment: { malformed: true },
          },
        },
      }),
    ]);

    expect([
      arrayPayload.status(),
      malformedAuditAdmin.status(),
      malformedApprovalComment.status(),
    ]).toEqual([400, 400, 400]);
    expect([
      await arrayPayload.json(),
      await malformedAuditAdmin.json(),
      await malformedApprovalComment.json(),
    ]).toEqual([
      { error: "ข้อมูลคำขอไม่ถูกต้อง" },
      { error: "ตัวกรองประวัติไม่ถูกต้อง" },
      { error: "ข้อมูลการอนุมัติไม่ถูกต้อง" },
    ]);
  } finally {
    await admin.close();
  }
});

test("time/payroll routes reject invalid dates, months, and non-finite JSON numbers at the HTTP boundary", async ({ browser }) => {
  const admin = await context(browser, "super_admin");
  const user = await context(browser, "user");
  try {
    const [
      nonFiniteAdminAmount,
      invalidEffectiveDate,
      zeroYearEffectiveDate,
      invalidPreviewMonth,
      invalidCreateMonth,
      zeroYearPreviewMonth,
      nonFiniteUserAmount,
      zeroYearUserMonth,
    ] = await Promise.all([
      admin.request.post("/api/lanflow/time-tracking/admin", {
        headers: { "Content-Type": "application/json" },
        data: `{"action":"CREATE_DEBT","payload":{"user_id":"${crypto.randomUUID()}","amount":1e400,"effective_date":"2026-09-30","description":"test"}}`,
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "CREATE_DEBT",
          payload: { user_id: crypto.randomUUID(), amount: 1, effective_date: "2026-02-30", description: "test" },
        },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: {
          action: "CREATE_DEBT",
          payload: { user_id: crypto.randomUUID(), amount: 1, effective_date: "0000-01-01", description: "test" },
        },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: { action: "PREVIEW_PAYROLL_SLIP", payload: { user_id: crypto.randomUUID(), month: "2026-13" } },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: { action: "CREATE_PAYROLL_SLIP", payload: { user_id: crypto.randomUUID(), month: "2026-00" } },
      }),
      admin.request.post("/api/lanflow/time-tracking/admin", {
        data: { action: "PREVIEW_PAYROLL_SLIP", payload: { user_id: crypto.randomUUID(), month: "0000-01" } },
      }),
      user.request.post("/api/lanflow/time-tracking/user", {
        headers: { "Content-Type": "application/json" },
        data: '{"action":"REQUEST_WITHDRAWAL","payload":{"amount":1e400}}',
      }),
      user.request.get("/api/lanflow/time-tracking/user?month=0000-01"),
    ]);

    expect([
      await nonFiniteAdminAmount.json(),
      await invalidEffectiveDate.json(),
      await zeroYearEffectiveDate.json(),
      await invalidPreviewMonth.json(),
      await invalidCreateMonth.json(),
      await zeroYearPreviewMonth.json(),
      await nonFiniteUserAmount.json(),
      await zeroYearUserMonth.json(),
    ]).toEqual([
      { error: "ข้อมูลรายการไม่ถูกต้อง" },
      { error: "ข้อมูลรายการไม่ถูกต้อง" },
      { error: "ข้อมูลรายการไม่ถูกต้อง" },
      { error: "ข้อมูลสลิปไม่ถูกต้อง" },
      { error: "ข้อมูลสลิปไม่ถูกต้อง" },
      { error: "ข้อมูลสลิปไม่ถูกต้อง" },
      { error: "ข้อมูลรายการไม่ถูกต้อง" },
      { error: "เดือนไม่ถูกต้อง" },
    ]);
  } finally {
    await Promise.all([admin.close(), user.close()]);
  }
});

test("history routes reject incomplete and malformed keyset cursors", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  const locationId = await primaryLocationId(manager);
  const malformed = encodeURIComponent(cursor({
    version: 1,
    ownerUserId: "missing",
    locationId,
    view: "current",
    at: "not-a-time",
  }));
  try {
    for (const path of [
      `/api/lanflow/reports?locationId=${locationId}&cursor=${malformed}`,
      `/api/lanflow/rubber-exports?locationId=${locationId}&cursor=${malformed}`,
      `/api/lanflow/cash-counts?locationId=${locationId}&cursor=${malformed}`,
    ]) {
      const response = await manager.request.get(path);
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await manager.close();
  }
});

test("report history canonicalizes parseable cursor timestamps before building filters", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const authResponse = await manager.request.get("/api/auth/me");
    expect(authResponse.ok()).toBe(true);
    const { profile } = await authResponse.json() as {
      profile: { id: string; locationIds: string[] };
    };
    const parseableButUnsafe = encodeURIComponent(cursor({
      version: 1,
      ownerUserId: profile.id,
      locationId: profile.locationIds[0],
      view: "current",
      at: "Thu, 01 Jan 2026 00:00:00 GMT (cursor comment)",
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }));

    const response = await manager.request.get(
      `/api/lanflow/reports?locationId=${profile.locationIds[0]}&cursor=${parseableButUnsafe}`,
    );
    expect(response.status()).toBe(200);
  } finally {
    await manager.close();
  }
});

test("slip OCR rejects missing and unsupported uploads before upstream work", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const missing = await manager.request.post("/api/lanflow/ocr-slip", {
      multipart: {},
    });
    expect(missing.status()).toBe(400);

    const unsupported = await manager.request.post("/api/lanflow/ocr-slip", {
      multipart: {
        image: {
          name: "slip.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("not an image"),
        },
      },
    });
    expect(unsupported.status()).toBe(400);
  } finally {
    await manager.close();
  }
});

test("approval decision routes reject malformed request IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    for (const path of [
      "/api/lanflow/income-expense/approval-requests/not-a-uuid/decide",
      "/api/lanflow/cash-branch-transfers/delete-requests/not-a-uuid/decide",
    ]) {
      const response = await manager.request.post(path, {
        data: { decision: "approved" },
      });
      expect(response.status(), path).toBe(400);
    }
  } finally {
    await manager.close();
  }
});

test("income-expense approval decisions reject malformed comments before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const response = await manager.request.post(
      `/api/lanflow/income-expense/approval-requests/${crypto.randomUUID()}/decide`,
      { data: { decision: "approved", comment: { malformed: true } } },
    );

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      status: "failed",
      errorMessage: "Invalid request body",
    });
  } finally {
    await manager.close();
  }
});

test("cash transfer mutation routes reject malformed transfer IDs without exposing PostgreSQL diagnostics", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [update, deletion] = await Promise.all([
      manager.request.patch("/api/lanflow/cash-branch-transfers/not-a-uuid", {
        data: {},
      }),
      manager.request.delete("/api/lanflow/cash-branch-transfers/not-a-uuid"),
    ]);
    expect([update.status(), deletion.status()]).toEqual([400, 400]);
    expect([await update.json(), await deletion.json()]).toEqual([
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
    ]);
  } finally {
    await manager.close();
  }
});

test("cash transfer routes reject malformed UUID payloads before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const validTransferId = "00000000-0000-4000-8000-000000000099";
    const me = await manager.request.get("/api/auth/me");
    expect(me.ok()).toBe(true);
    const locationIds = (await me.json() as { profile: { locationIds: string[] } }).profile.locationIds;
    expect(locationIds.length).toBeGreaterThanOrEqual(2);
    const zeroCounts = {
      coin1: 0,
      coin2: 0,
      coin5: 0,
      coin10: 0,
      banknote20: 0,
      banknote50: 0,
      banknote100: 0,
      banknote500: 0,
      banknote1000: 0,
    };
    const invalidCounts = { ...zeroCounts, coin1: "not-an-integer" };
    const oversizedCounts = { ...zeroCounts, coin1: 2_147_483_648 };
    const weightedOverflowCounts = { ...zeroCounts, banknote1000: 2_147_484 };
    const [
      creation,
      update,
      receipt,
      denomination,
      oversizedDenomination,
      zeroCreation,
      zeroUpdate,
      weightedOverflowCreation,
      weightedOverflowReceipt,
    ] = await Promise.all([
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: "not-a-uuid",
          targetLocationId: "also-not-a-uuid",
          sent: {},
        },
      }),
      manager.request.patch(`/api/lanflow/cash-branch-transfers/${validTransferId}`, {
        data: { targetLocationId: "not-a-uuid", sent: {} },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers/not-a-uuid/receive", {
        data: { received: {} },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: locationIds[1],
          sent: invalidCounts,
        },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: locationIds[1],
          sent: oversizedCounts,
        },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: locationIds[1],
          sent: zeroCounts,
        },
      }),
      manager.request.patch(`/api/lanflow/cash-branch-transfers/${validTransferId}`, {
        data: { targetLocationId: locationIds[1], sent: zeroCounts },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: locationIds[1],
          sent: weightedOverflowCounts,
        },
      }),
      manager.request.post(`/api/lanflow/cash-branch-transfers/${validTransferId}/receive`, {
        data: { received: weightedOverflowCounts },
      }),
    ]);

    expect([
      creation.status(),
      update.status(),
      receipt.status(),
      denomination.status(),
      oversizedDenomination.status(),
      zeroCreation.status(),
      zeroUpdate.status(),
      weightedOverflowCreation.status(),
      weightedOverflowReceipt.status(),
    ]).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400]);
    expect([
      await creation.json(),
      await update.json(),
      await receipt.json(),
      await denomination.json(),
      await oversizedDenomination.json(),
      await zeroCreation.json(),
      await zeroUpdate.json(),
      await weightedOverflowCreation.json(),
      await weightedOverflowReceipt.json(),
    ]).toEqual([
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
    ]);
  } finally {
    await manager.close();
  }
});

test("cash transfer routes reject malformed optional text fields before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const me = await manager.request.get("/api/auth/me");
    expect(me.ok()).toBe(true);
    const locationIds = (await me.json() as { profile: { locationIds: string[] } }).profile.locationIds;
    expect(locationIds.length).toBeGreaterThan(0);
    const sent = {
      coin1: 1,
      coin2: 0,
      coin5: 0,
      coin10: 0,
      banknote20: 0,
      banknote50: 0,
      banknote100: 0,
      banknote500: 0,
      banknote1000: 0,
    };
    const missingTargetId = crypto.randomUUID();
    const missingTransferId = crypto.randomUUID();
    const [
      emptyClientId,
      invalidIdempotencyKey,
      invalidCreateNote,
      invalidUpdateNote,
      invalidDecisionComment,
    ] = await Promise.all([
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: missingTargetId,
          sent,
          clientTempId: "",
        },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: missingTargetId,
          sent,
          idempotencyKey: { malformed: true },
        },
      }),
      manager.request.post("/api/lanflow/cash-branch-transfers", {
        data: {
          sourceLocationId: locationIds[0],
          targetLocationId: missingTargetId,
          sent,
          note: { malformed: true },
        },
      }),
      manager.request.patch(`/api/lanflow/cash-branch-transfers/${missingTransferId}`, {
        data: {
          targetLocationId: missingTargetId,
          sent,
          note: { malformed: true },
        },
      }),
      manager.request.post(
        `/api/lanflow/cash-branch-transfers/delete-requests/${crypto.randomUUID()}/decide`,
        { data: { decision: "approved", comment: { malformed: true } } },
      ),
    ]);

    expect([
      emptyClientId.status(),
      invalidIdempotencyKey.status(),
      invalidCreateNote.status(),
      invalidUpdateNote.status(),
      invalidDecisionComment.status(),
    ]).toEqual([400, 400, 400, 400, 400]);
    expect([
      await emptyClientId.json(),
      await invalidIdempotencyKey.json(),
      await invalidCreateNote.json(),
      await invalidUpdateNote.json(),
      await invalidDecisionComment.json(),
    ]).toEqual([
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลไม่ถูกต้อง" },
      { error: "ข้อมูลคำตัดสินไม่ถูกต้อง" },
    ]);
  } finally {
    await manager.close();
  }
});

test("report detail routes reject malformed report IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [detail, deletion] = await Promise.all([
      manager.request.get("/api/lanflow/reports/not-a-uuid"),
      manager.request.delete("/api/lanflow/reports/not-a-uuid"),
    ]);
    expect([detail.status(), deletion.status()]).toEqual([400, 400]);
  } finally {
    await manager.close();
  }
});

test("rubber export detail routes reject malformed export IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [detail, update, deletion] = await Promise.all([
      manager.request.get("/api/lanflow/rubber-exports/not-a-uuid"),
      manager.request.patch("/api/lanflow/rubber-exports/not-a-uuid", {
        data: { currentWeight: 1, workRate: 0, otherOperatingCost: 0 },
      }),
      manager.request.delete("/api/lanflow/rubber-exports/not-a-uuid"),
    ]);
    expect([detail.status(), update.status(), deletion.status()]).toEqual([400, 400, 400]);
  } finally {
    await manager.close();
  }
});

test("report collection routes reject malformed location IDs before PostgreSQL", async ({ browser }) => {
  const manager = await context(browser, "super_admin");
  try {
    const [list, create] = await Promise.all([
      manager.request.get("/api/lanflow/reports?locationId=not-a-uuid"),
      manager.request.post("/api/lanflow/reports", {
        data: { locationId: "not-a-uuid" },
      }),
    ]);
    expect([list.status(), create.status()]).toEqual([400, 400]);
  } finally {
    await manager.close();
  }
});
