import { expect, test, type Page } from "@playwright/test";

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

async function openCreateWexForm(page: Page) {
  await page.getByRole("button", { name: "สร้างบิลรถส่งออก" }).click();
  const form = page.getByRole("dialog", { name: "สร้างบิลรถส่งออก" });
  const branchGuard = page.getByRole("alertdialog", { name: "ยืนยันสาขาก่อนสร้างรายการ" });
  await expect(form.or(branchGuard)).toBeVisible();
  if (await branchGuard.isVisible()) {
    const heading = await page.getByRole("heading", { name: /^บิลรถส่งออก \(WEX\) · / }).innerText();
    const locationName = heading.split("·").at(-1)?.trim() ?? "";
    await branchGuard.getByRole("button", { name: `เลือกสาขา ${locationName}`, exact: true }).click();
  }
  await expect(form).toBeVisible();
  return form;
}

function minutesBetween(later: string, earlier: string) {
  return (Date.parse(`${later}:00+07:00`) - Date.parse(`${earlier}:00+07:00`)) / 60_000;
}

test("clears WEX delete confirmation on reconnect and keeps a confirmed deletion absent", async ({ page }) => {
  let deleted = false;
  let deletes = 0;
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true; deletes += 1;
      return route.fulfill({ json: { id: summary.id, wexNo: summary.wexNo, status: "deleted" } });
    }
    return route.fulfill({ json: { bills: deleted ? [] : [summary], hasMore: false, nextCursor: null,
      permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const deleteButton = page.getByRole("button", { name: `ลบ ${summary.wexNo}` });
  await deleteButton.click();
  const confirmation = page.getByRole("alertdialog", { name: "ลบบิลรถส่งออก" });
  await expect(confirmation).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(confirmation).not.toBeVisible();
  expect(deletes).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await deleteButton.click();
  await confirmation.getByRole("button", { name: "ลบ WEX", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(deleteButton).toHaveCount(0);
  await expect(page.getByText("ยังไม่มีบิลรถส่งออก", { exact: true })).toBeVisible();
  expect(deletes).toBe(1);
});

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
  const openedAt = Date.now();
  const dialog = await openCreateWexForm(page);
  const truck = dialog.getByRole("group", { name: "รถบรรทุก" });
  const truckInboundAt = truck.getByLabel("เวลาเข้ารถบรรทุก");
  const truckCarrier = truck.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
  const truckInbound = truck.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" });
  const truckOutbound = truck.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" });
  await expect(truckInboundAt).not.toHaveAttribute("readonly");
  const initialInboundAt = Date.parse(`${await truckInboundAt.inputValue()}:00+07:00`);
  expect(Math.abs(initialInboundAt - (openedAt - (2 * 60 * 60 * 1_000)))).toBeLessThan(90_000);
  await expect(truck.getByLabel("เวลาออกรถบรรทุก")).toHaveAttribute("readonly", "");
  await expect(truckInbound).toHaveValue("0");
  await expect(truckOutbound).toHaveValue("0");
  await truckInbound.focus();
  await expect(truckInbound).toHaveValue("");
  await truckInbound.blur();
  await expect(truckInbound).toHaveValue("0");

  await truckCarrier.fill("ผู้ขนส่งเที่ยวแรก");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected add-trailer button");
    button.click();
    button.click();
  });
  const trailer = dialog.getByRole("group", { name: "หางพ่วง" });
  await expect(trailer).toHaveCount(1);
  const trailerCarrier = trailer.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" });
  const trailerInbound = trailer.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" });
  const trailerOutbound = trailer.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" });
  await expect(trailer.getByLabel("เวลาเข้าหางพ่วง")).toHaveAttribute("readonly", "");
  await expect(trailer.getByLabel("เวลาออกหางพ่วง")).toHaveAttribute("readonly", "");
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

test("cancels a pending WEX options request when the create form closes", async ({ page }) => {
  let optionsRequestStarted = false;
  let releaseOptions = () => {};
  const optionsGate = new Promise<void>((resolve) => {
    releaseOptions = resolve;
  });

  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) {
      optionsRequestStarted = true;
      await optionsGate;
      return route.abort();
    }
    return route.fulfill({
      json: {
        bills: [],
        hasMore: false,
        nextCursor: null,
        permissions: { canCreate: true, canEdit: true, canDelete: true },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const dialog = await openCreateWexForm(page);
  await expect.poll(() => optionsRequestStarted).toBe(true);

  try {
    await dialog.getByRole("button", { name: "ยกเลิก" }).click();
    await expect(page.getByRole("button", { name: "สร้างบิลรถส่งออก" })).toBeEnabled({ timeout: 1_000 });
  } finally {
    releaseOptions();
  }
});

test("puts WEX management first and keeps edit and delete outside the detail modal", async ({ page }) => {
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: details });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();

  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader").first()).toHaveText("จัดการ");
  await expect(table.getByRole("columnheader", { name: "การทำงาน" })).toHaveCount(0);
  const actionButtons = table.getByRole("row").nth(1).getByRole("button");
  await expect(actionButtons).toHaveCount(4);
  await expect(actionButtons.nth(0)).toHaveAccessibleName(`ดูรายละเอียด ${summary.wexNo}`);
  await expect(actionButtons.nth(1)).toHaveAccessibleName(`แก้ ${summary.wexNo}`);
  await expect(actionButtons.nth(2)).toHaveAccessibleName(`ลบ ${summary.wexNo}`);
  await expect(actionButtons.nth(3)).toHaveAccessibleName(`แชร์ PDF ${summary.wexNo}`);

  await actionButtons.nth(0).click();
  const detailDialog = page.getByRole("dialog", { name: summary.wexNo });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: /^แก้/ })).toHaveCount(0);
  await expect(detailDialog.getByRole("button", { name: /^ลบ/ })).toHaveCount(0);
  await detailDialog.getByRole("button", { name: "ปิด" }).click();

  await table.getByRole("button", { name: `ลบ ${summary.wexNo}` }).click();
  await expect(page.getByRole("alertdialog", { name: "ลบบิลรถส่งออก" })).toBeVisible();
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
  const dialog = await openCreateWexForm(page);
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
  const dialog = await openCreateWexForm(page);
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 0001");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("0");
  await expect(dialog.getByLabel("เวลาออกรถบรรทุก")).toHaveValue("");
  await expect(dialog.getByLabel("เวลาออกรถบรรทุก")).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนหางพ่วง" }).fill("กข 0002");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" }).fill("500");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" }).fill("600");
  await dialog.getByRole("button", { name: "บันทึก WEX" }).click();
  await expect(dialog.getByRole("alert")).toContainText("ต้องชั่งออกรถบรรทุกก่อนหางพ่วง");
  await dialog.getByRole("button", { name: "ลบหางพ่วง" }).click();
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

test("calculates ordered WEX times and recovers after truck outbound reset", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    return route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const dialog = await openCreateWexForm(page);
  const truckInbound = dialog.getByLabel("เวลาเข้ารถบรรทุก");
  const truckOutbound = dialog.getByLabel("เวลาออกรถบรรทุก");
  await truckInbound.fill("2026-09-05T10:00");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
  await expect(truckOutbound).toHaveValue("2026-09-05T10:30");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1500");
  await expect(truckOutbound).toHaveValue("2026-09-05T10:30");

  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  const trailerInbound = dialog.getByLabel("เวลาเข้าหางพ่วง");
  const trailerOutbound = dialog.getByLabel("เวลาออกหางพ่วง");
  await expect(trailerInbound).toHaveValue("2026-09-05T10:01");
  await expect(truckOutbound).toHaveValue("2026-09-05T10:30");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" }).fill("700");
  await expect(trailerOutbound).toHaveValue("2026-09-05T10:31");

  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("0");
  await expect(truckOutbound).toHaveValue("");
  await expect(trailerOutbound).toHaveValue("");
  await expect(dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" })).toHaveValue("700");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
  await expect(truckOutbound).toHaveValue("2026-09-05T10:30");
  await expect(trailerOutbound).toHaveValue("2026-09-05T10:31");

  await truckInbound.fill("2026-09-05T11:00");
  await expect(trailerInbound).toHaveValue("2026-09-05T11:01");
  await expect(truckOutbound).toHaveValue("2026-09-05T11:30");
  await expect(trailerOutbound).toHaveValue("2026-09-05T11:31");
});

test("keeps trailer outbound pending until truck outbound is available", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.999_999; });
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    return route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const dialog = await openCreateWexForm(page);
  await dialog.getByLabel("เวลาเข้ารถบรรทุก").fill("2026-09-05T10:00");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกหางพ่วง" }).fill("700");
  await expect(dialog.getByLabel("เวลาออกหางพ่วง")).toHaveValue("");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");

  const truckInbound = await dialog.getByLabel("เวลาเข้ารถบรรทุก").inputValue();
  const trailerInbound = await dialog.getByLabel("เวลาเข้าหางพ่วง").inputValue();
  const truckOutbound = await dialog.getByLabel("เวลาออกรถบรรทุก").inputValue();
  const trailerOutbound = await dialog.getByLabel("เวลาออกหางพ่วง").inputValue();
  expect(minutesBetween(trailerInbound, truckInbound)).toBe(3);
  expect(minutesBetween(truckOutbound, truckInbound)).toBe(180);
  expect(minutesBetween(trailerOutbound, truckOutbound)).toBe(3);
});

test("preserves stored WEX times on edit and recalculates after an explicit truck inbound change", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    if (url.pathname.endsWith(`/${summary.id}`)) return route.fulfill({ json: details });
    return route.fulfill({ json: { bills: [summary], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  await page.getByRole("button", { name: `แก้ ${summary.wexNo}` }).click();
  const dialog = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  await expect(dialog.getByLabel("เวลาเข้ารถบรรทุก")).toHaveValue("2026-08-24T15:00");
  await expect(dialog.getByLabel("เวลาออกรถบรรทุก")).toHaveValue("2026-08-24T16:00");
  await dialog.getByLabel("เวลาเข้ารถบรรทุก").fill("2026-08-24T17:00");
  await expect(dialog.getByLabel("เวลาออกรถบรรทุก")).toHaveValue("2026-08-24T17:30");
});

test("samples a calculated WEX time once outside React state updaters", async ({ page }) => {
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    return route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const dialog = await openCreateWexForm(page);
  await dialog.getByLabel("เวลาเข้ารถบรรทุก").fill("2026-09-05T10:00");
  await page.evaluate(() => {
    let calls = 0;
    Object.defineProperty(window, "__wexRandomCalls", { configurable: true, get: () => calls });
    Math.random = () => { calls += 1; return 0; };
  });

  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
  expect(await page.evaluate(() => (
    window as Window & Partial<{ __wexRandomCalls: number }>
  ).__wexRandomCalls)).toBe(1);
});

test("keeps a calculated time while replacing one positive outbound weight with another", async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route("**/api/lanflow/export-vehicle-weigh-bills**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/options")) return route.fulfill({ json: { rubberExports: [], carriers: [] } });
    return route.fulfill({ json: { bills: [], hasMore: false, nextCursor: null, permissions: { canCreate: true, canEdit: true, canDelete: true } } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("tab", { name: "บิลรถส่งออก (WEX)" }).click();
  const dialog = await openCreateWexForm(page);
  await dialog.getByLabel("เวลาเข้ารถบรรทุก").fill("2026-09-05T10:00");
  const outboundWeight = dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" });
  const outboundAt = dialog.getByLabel("เวลาออกรถบรรทุก");
  await outboundWeight.fill("1400");
  await expect(outboundAt).toHaveValue("2026-09-05T10:30");
  await page.evaluate(() => { Math.random = () => 0.999_999; });

  await outboundWeight.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await outboundWeight.press("Backspace");
  await outboundWeight.pressSequentially("1500");
  await expect(outboundAt).toHaveValue("2026-09-05T10:30");

  await outboundWeight.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await outboundWeight.press("Backspace");
  await outboundWeight.blur();
  await expect(outboundWeight).toHaveValue("0");
  await expect(outboundAt).toHaveValue("");
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
  const dialog = await openCreateWexForm(page);
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 1000");
  await dialog.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" }).fill("นายสมชาย ขนส่งเอง");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนหางพ่วง" }).fill("กข 2000");
  const trailerCarrier = dialog.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" });
  await expect(trailerCarrier).toHaveAttribute("readonly", "");
  await expect(trailerCarrier).toHaveValue("นายสมชาย ขนส่งเอง");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" }).fill("2000");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
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
  const dialog = await openCreateWexForm(page);
  await dialog.getByRole("textbox", { name: "ทะเบียนรถบรรทุก" }).fill("กข 3000");
  const carrierInput = dialog.getByRole("combobox", { name: "ผู้ขนส่งรถบรรทุก" });
  await carrierInput.fill(sameNameCarriers[0].carrierName);
  await carrierInput.press("ArrowDown");
  await expect(carrierInput).toHaveAttribute("aria-activedescendant", new RegExp(`${sameNameCarriers[1].carrierId}$`));
  await carrierInput.press("Enter");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้ารถบรรทุก" }).fill("1000");
  await dialog.getByRole("button", { name: "เพิ่มหางพ่วง" }).click();
  await dialog.getByRole("textbox", { name: "ทะเบียนหางพ่วง" }).fill("กข 3001");
  await expect(dialog.getByRole("textbox", { name: "ผู้ขนส่งหางพ่วง" }))
    .toHaveValue(sameNameCarriers[1].carrierName);
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาเข้าหางพ่วง" }).fill("800");
  await dialog.getByRole("spinbutton", { name: "น้ำหนักขาออกรถบรรทุก" }).fill("1400");
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
  await page.getByRole("button", { name: `แก้ ${summary.wexNo}` }).click();
  const form = page.getByRole("dialog", { name: `แก้ไข ${summary.wexNo}` });
  await expect(form.getByLabel("เวลาเข้ารถบรรทุก")).toHaveValue("2026-08-24T15:00");
  await expect(form.getByLabel("เวลาออกรถบรรทุก")).toHaveValue("2026-08-24T16:00");
  await expect(form.getByLabel("เวลาออกรถบรรทุก")).toHaveAttribute("readonly", "");
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
  await page.getByRole("button", { name: `แก้ ${summary.wexNo}` }).click();
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
  await page.getByRole("button", { name: `แก้ ${summary.wexNo}` }).click();
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
  await page.getByRole("button", { name: `แก้ ${summary.wexNo}` }).click();
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
