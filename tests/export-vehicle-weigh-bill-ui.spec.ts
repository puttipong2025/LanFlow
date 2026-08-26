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

test("uses truck and tail-trailer roles with shared carrier and Rubber Bill focus-zero weights", async ({ page }) => {
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) {
      await route.fulfill({ json: { rubberExports: [], carriers: [] } });
      return;
    }
    await route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();

  const dialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  const truck = dialog.getByRole("group", { name: "รถบรรทุก" });
  const truckCarrier = truck.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
  const truckInbound = truck.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" });
  const truckOutbound = truck.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" });
  await expect(truckInbound).toHaveValue("0");
  await expect(truckOutbound).toHaveValue("0");
  await truckInbound.focus();
  await expect(truckInbound).toHaveValue("");
  await truckInbound.blur();
  await expect(truckInbound).toHaveValue("0");

  await truckCarrier.fill("ผู้ขนส่งเที่ยวแรก");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  const trailer = dialog.getByRole("group", { name: "หางพ่วง" });
  const trailerCarrier = trailer.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" });
  const trailerInbound = trailer.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" });
  const trailerOutbound = trailer.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" });
  await expect(trailerCarrier).toHaveAttribute("readonly", "");
  await expect(trailerCarrier).toHaveValue("ผู้ขนส่งเที่ยวแรก");
  await truckCarrier.fill("ผู้ขนส่งเที่ยวแก้ไข");
  await expect(trailerCarrier).toHaveValue("ผู้ขนส่งเที่ยวแก้ไข");
  await truckCarrier.fill("");
  await expect(trailerCarrier).toHaveValue("");
  await expect(trailerInbound).toHaveValue("0");
  await expect(trailerOutbound).toHaveValue("0");
  await trailerOutbound.focus();
  await expect(trailerOutbound).toHaveValue("");
  await trailerOutbound.blur();
  await expect(trailerOutbound).toHaveValue("0");
  await expect(truck.getByRole("button", { name: /ลบ/ })).toHaveCount(0);
  await expect(trailer.getByRole("button", { name: "ลบหางพ่วง" })).toBeVisible();
});

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

  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 9999");
  await dialog.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" }).fill("บริษัทขนส่ง WEX");
  await dialog.getByRole("option", { name: /บริษัทขนส่ง WEX.*00000102/ }).click();
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
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
  await expect(detailDialog).toContainText("รถบรรทุก");
  const downloadPromise = page.waitForEvent("download");
  await detailDialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("LanFlow-export-vehicle-weigh-bill-WEX-20260824-001-80mm.pdf");
  await expect(page.getByText("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว")).toBeVisible();
});

test("creates an inbound-only WEX with zero outbound weight and no REX reservation", async ({ page }) => {
  const writes: unknown[] = [];
  const pendingDetails = {
    ...details,
    vehicleNetWeight: 0,
    remainingWeight: 0,
    lines: [{
      ...details.lines[0],
      outboundAt: null,
      outboundWeight: 0,
      netWeight: 0,
    }],
  };
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/options")) {
      return route.fulfill({
        json: {
          rubberExports: [{ rubberExportId: "rex-ui-pending", exportNo: "REX-20260824-099", currentWeight: 100 }],
          carriers: [],
        },
      });
    }
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: summary.id, wexNo: summary.wexNo, revision: 1 } });
    }
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: pendingDetails });
    return route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();
  const dialog = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 0001");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("0");
  await dialog.getByLabel("เวลาออก").fill("");
  await expect(dialog.getByRole("checkbox", { name: "เลือก REX-20260824-099" })).toBeDisabled();
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    lines: [expect.objectContaining({
      vehicleRegistration: "กข 0001",
      inboundWeight: 1000,
      outboundAt: null,
      outboundWeight: 0,
    })],
    rubberExportIds: [],
  })]);
  await expect(page.getByRole("dialog", { name: summary.wexNo })).toContainText("รอชั่งออก");
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
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 1000");
  await dialog.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" }).fill("นายสมชาย ขนส่งเอง");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนหางพ่วง" }).fill("กข 2000");
  const trailerCarrier = dialog.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" });
  await expect(trailerCarrier).toHaveAttribute("readonly", "");
  await expect(trailerCarrier).toHaveValue("นายสมชาย ขนส่งเอง");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" }).fill("2000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" }).fill("2300");
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    lines: [
      expect.objectContaining({ carrierId: null, carrierName: "นายสมชาย ขนส่งเอง" }),
      expect.objectContaining({ carrierId: null, carrierName: "นายสมชาย ขนส่งเอง" }),
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
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 3000");
  const carrierInput = dialog.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
  await carrierInput.fill(sameNameCarriers[0].carrierName);
  await carrierInput.press("ArrowDown");
  await expect(carrierInput).toHaveAttribute("aria-activedescendant", new RegExp(`${sameNameCarriers[1].carrierId}$`));
  await carrierInput.press("Enter");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนหางพ่วง" }).fill("กข 3001");
  await expect(dialog.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" }))
    .toHaveValue(sameNameCarriers[1].carrierName);
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" }).fill("800");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" }).fill("900");
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();

  await expect.poll(() => writes).toEqual([expect.objectContaining({
    lines: [
      expect.objectContaining({ carrierId: sameNameCarriers[1].carrierId, carrierName: sameNameCarriers[1].carrierName }),
      expect.objectContaining({ carrierId: sameNameCarriers[1].carrierId, carrierName: sameNameCarriers[1].carrierName }),
    ],
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
  await expect(form.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" })).toHaveValue("ผู้ขนส่งเดิม");
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
  await expect(form.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" })).toHaveValue("ชื่อผู้ขนส่งเดิม");
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
  const carrierInput = form.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
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
  const carrierInput = form.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
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
