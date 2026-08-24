import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const summary = {
  id: "wex-ui-1",
  wexNo: "WEX-20260824-001",
  locationId: "location-wex-ui",
  locationName: "สาขาทดสอบ WEX",
  revision: 1,
  vehicleCount: 1,
  rubberExportCount: 0,
  vehicleNetWeight: 400,
  reservedRubberWeight: 0,
  remainingWeight: 400,
  createdByName: "ผู้จัดการทดสอบ",
  createdAt: "2026-08-24T08:15:00.000Z",
  updatedAt: "2026-08-24T08:15:00.000Z",
};

const details = {
  ...summary,
  lines: [{
    id: "wex-ui-line-1",
    sequenceNo: 1,
    vehicleRegistration: "กข 9999",
    carrierId: "carrier-ui-1",
    carrierName: "บริษัทขนส่ง WEX",
    inboundAt: "2026-08-24T08:00:00.000Z",
    inboundWeight: 1000,
    outboundAt: "2026-08-24T09:00:00.000Z",
    outboundWeight: 1400,
    netWeight: 400,
  }],
  rubberExports: [],
};

const sameNameCarriers = [
  { carrierId: "00000000-0000-4000-8000-000000000101", carrierName: "บริษัทขนส่ง WEX" },
  { carrierId: "00000000-0000-4000-8000-000000000102", carrierName: "บริษัทขนส่ง WEX" },
];

test("keeps purchase bills as the default view and creates an online WEX with an accessible validated form", async ({ page }) => {
  const writes: Array<{ method: string; body: unknown }> = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new Error("share should not run"); } });
  });
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) {
      await route.fulfill({ json: { rubberExports: [{ rubberExportId: "rex-ui-1", exportNo: "REX-20260823-001", currentWeight: 300 }], carriers: sameNameCarriers } });
      return;
    }
    if (request.method() === "POST") {
      writes.push({ method: request.method(), body: request.postDataJSON() });
      await route.fulfill({ status: 201, json: { id: summary.id, wexNo: summary.wexNo, revision: 1 } });
      return;
    }
    if (url.pathname.endsWith(`/${summary.id}`)) {
      await route.fulfill({ json: details });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: "unexpected WEX request" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "บัตรคิว", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "บิลรับซื้อยาง" })).toHaveAttribute("aria-selected", "true");

  const wexTab = page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" });
  await wexTab.click();
  await expect(page.getByRole("heading", { name: /บิลรถส่งออก/ })).toBeVisible();
  await wexTab.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "บิลรับซื้อยาง" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "บิลรับซื้อยาง" }).press("ArrowRight");
  await expect(wexTab).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();

  const dialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();
  await expect(dialog.getByRole("alert")).toContainText("กรุณากรอกทะเบียนรถ");

  await dialog.getByRole("textbox", { name: "ทะเบียนรถคันที่ 1" }).fill("กข 9999");
  await dialog.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" }).fill("บริษัทขนส่ง WEX");
  await dialog.getByRole("option", { name: /บริษัทขนส่ง WEX.*00000102/ }).click();
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าคันที่ 1" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกคันที่ 1" }).fill("1400");
  await dialog.getByRole("checkbox", { name: "เลือก REX-20260823-001" }).check();
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([{
    method: "POST",
    body: expect.objectContaining({
      lines: [expect.objectContaining({ vehicleRegistration: "กข 9999", carrierId: sameNameCarriers[1].carrierId, carrierName: "บริษัทขนส่ง WEX", inboundWeight: 1000, outboundWeight: 1400 })],
      rubberExportIds: ["rex-ui-1"],
    }),
  }]);

  const detailDialog = page.getByRole("dialog", { name: summary.wexNo });
  await expect(detailDialog).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await detailDialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("LanFlow-export-vehicle-weigh-bill-WEX-20260824-001-80mm.pdf");
  await expect(page.getByText("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว")).toBeVisible();
});

test("submits a manual carrier snapshot and a blank carrier", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: summary.id, wexNo: summary.wexNo, revision: 1 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: details });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  await dialog.getByRole("textbox", { name: "ทะเบียนรถคันที่ 1" }).fill("กข 1000");
  await dialog.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" }).fill("นายสมชาย ขนส่งเอง");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าคันที่ 1" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกคันที่ 1" }).fill("1400");
  await dialog.getByRole("button", { name: "เพิ่มรถคันที่ 2" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนรถคันที่ 2" }).fill("กข 2000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าคันที่ 2" }).fill("2000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกคันที่ 2" }).fill("2300");
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    lines: [
      expect.objectContaining({ carrierId: null, carrierName: "นายสมชาย ขนส่งเอง" }),
      expect.objectContaining({ carrierId: null, carrierName: null }),
    ],
  })]);
});

test("submits the second same-name carrier with ArrowDown and Enter", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: sameNameCarriers } });
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: summary.id, wexNo: summary.wexNo, revision: 1 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: details });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  await dialog.getByRole("textbox", { name: "ทะเบียนรถคันที่ 1" }).fill("กข 3000");
  const carrierInput = dialog.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" });
  await carrierInput.fill(sameNameCarriers[0].carrierName);
  await carrierInput.press("ArrowDown");
  await expect(carrierInput).toHaveAttribute("aria-activedescendant", new RegExp(`${sameNameCarriers[1].carrierId}$`));
  await carrierInput.press("Enter");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าคันที่ 1" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกคันที่ 1" }).fill("1400");
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    lines: [expect.objectContaining({ carrierId: sameNameCarriers[1].carrierId, carrierName: sameNameCarriers[1].carrierName })],
  })]);
});

test("keeps an edit carrier snapshot when the carrier is absent from current options", async ({ page }) => {
  const legacyDetails = {
    ...details,
    lines: [{
      ...details.lines[0],
      carrierId: "00000000-0000-4000-8000-000000000001",
      carrierName: "ผู้ขนส่งเดิม",
    }],
  };
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    if (request.method() === "PATCH") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { id: summary.id, wexNo: summary.wexNo, revision: 2 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: legacyDetails });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "รายละเอียด" }).click();
  const detailDialog = page.getByRole("dialog", { name: summary.wexNo });
  await expect(detailDialog).toContainText("ผู้ขนส่งเดิม");
  await detailDialog.getByRole("button", { name: "แก้ไข" }).click();
  const form = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  await expect(form.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" })).toHaveValue("ผู้ขนส่งเดิม");
  await form.getByRole("button", { name: "บันทึกการแก้ไข" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    expectedRevision: 1,
    lines: [expect.objectContaining({ carrierId: null, carrierName: "ผู้ขนส่งเดิม" })],
  })]);
});

test("keeps a stored carrier snapshot when the active master was renamed", async ({ page }) => {
  const legacyDetails = {
    ...details,
    lines: [{
      ...details.lines[0],
      carrierId: "00000000-0000-4000-8000-000000000002",
      carrierName: "ชื่อผู้ขนส่งเดิม",
    }],
  };
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) {
      return route.fulfill({
        json: {
          rubberExports: [],
          carriers: [{
            carrierId: "00000000-0000-4000-8000-000000000002",
            carrierName: "ชื่อผู้ขนส่งใหม่",
          }],
        },
      });
    }
    if (request.method() === "PATCH") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { id: summary.id, wexNo: summary.wexNo, revision: 2 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: legacyDetails });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "รายละเอียด" }).click();
  const detailDialog = page.getByRole("dialog", { name: summary.wexNo });
  await detailDialog.getByRole("button", { name: "แก้ไข" }).click();
  const form = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  await expect(form.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" })).toHaveValue("ชื่อผู้ขนส่งเดิม");
  await form.getByRole("button", { name: "บันทึกการแก้ไข" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    expectedRevision: 1,
    lines: [expect.objectContaining({ carrierId: null, carrierName: "ชื่อผู้ขนส่งเดิม" })],
  })]);
});

test("selects the exact same-name carrier for an edit", async ({ page }) => {
  const editDetails = {
    ...details,
    lines: [{
      ...details.lines[0],
      carrierId: sameNameCarriers[0].carrierId,
      carrierName: sameNameCarriers[0].carrierName,
    }],
  };
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: sameNameCarriers } });
    if (request.method() === "PATCH") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { id: summary.id, wexNo: summary.wexNo, revision: 2 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: editDetails });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "รายละเอียด" }).click();
  await page.getByRole("dialog", { name: summary.wexNo }).getByRole("button", { name: "แก้ไข" }).click();
  const form = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  const carrierInput = form.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" });
  await carrierInput.click();
  await form.getByRole("option", { name: /บริษัทขนส่ง WEX.*00000102/ }).click();
  await form.getByRole("button", { name: "บันทึกการแก้ไข" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    expectedRevision: 1,
    lines: [expect.objectContaining({ carrierId: sameNameCarriers[1].carrierId, carrierName: sameNameCarriers[1].carrierName })],
  })]);
});

test("updates to the second same-name carrier with ArrowUp wrap and Enter", async ({ page }) => {
  const editDetails = {
    ...details,
    lines: [{
      ...details.lines[0],
      carrierId: sameNameCarriers[0].carrierId,
      carrierName: sameNameCarriers[0].carrierName,
    }],
  };
  const writes: unknown[] = [];
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: sameNameCarriers } });
    if (request.method() === "PATCH") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { id: summary.id, wexNo: summary.wexNo, revision: 2 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: editDetails });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "รายละเอียด" }).click();
  await page.getByRole("dialog", { name: summary.wexNo }).getByRole("button", { name: "แก้ไข" }).click();
  const form = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  const carrierInput = form.getByRole("combobox", { name: "ผู้ขนส่งรถคันที่ 1" });
  await carrierInput.focus();
  await carrierInput.press("ArrowUp");
  await expect(carrierInput).toHaveAttribute("aria-activedescendant", new RegExp(`${sameNameCarriers[1].carrierId}$`));
  await carrierInput.press("Enter");
  await form.getByRole("button", { name: "บันทึกการแก้ไข" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    expectedRevision: 1,
    lines: [expect.objectContaining({ carrierId: sameNameCarriers[1].carrierId, carrierName: sameNameCarriers[1].carrierName })],
  })]);
});
