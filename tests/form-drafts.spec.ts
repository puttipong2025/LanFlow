import { expect, test, type Page } from "@playwright/test";

async function clearFormDrafts(page: Page) {
  await page.goto("/");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("lanflow_form_drafts_db");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  }));
}

async function readFormDrafts(page: Page) {
  return page.evaluate(() => new Promise<Array<{
    key: string;
    ownerUserId: string;
    locationId: string;
    formType: string;
    data: Record<string, unknown>;
  }>>((resolve, reject) => {
    const request = indexedDB.open("lanflow_form_drafts_db");
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("form_drafts", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("form_drafts", "readonly");
      const getAll = transaction.objectStore("form_drafts").getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        db.close();
        resolve(getAll.result);
      };
    };
  }));
}

test.describe("persistent form drafts", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test.beforeEach(async ({ page }) => {
    await clearFormDrafts(page);
  });

  test.afterEach(async ({ page }) => {
    await clearFormDrafts(page).catch(() => {});
  });

  test("restores an unsaved Rubber Bill after reload", async ({ page }) => {
    const marker = `DRAFT-RUBBER-${Date.now()}`;

    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    const modal = page.locator(".fixed.inset-0").last();
    await modal.locator('input[name="customerName"]').fill(marker);
    const weighRow = modal.locator("table tbody tr").first();
    await weighRow.locator('input[type="number"]').nth(0).fill("1250");
    await weighRow.locator('input[type="number"]').nth(1).fill("250");
    await weighRow.locator('input[type="number"]').nth(3).fill("27.5");
    await modal.getByRole("button", { name: "หักน้ำหนักยาง", exact: true }).click();
    await modal.getByLabel("หักน้ำหนักยาง (กก.)").fill("12");
    await page.waitForTimeout(500);

    const locationId = await page.getByLabel(/^เลือกสาขา/).getAttribute("data-location-id");
    const response = await page.request.get("/api/lanflow");
    const data = await response.json() as { profile: { id: string } };
    await expect.poll(async () =>
      Boolean((await readFormDrafts(page)).find((draft) =>
        draft.ownerUserId === data.profile.id
        && draft.locationId === locationId
        && draft.formType === "rubber-bill"
      ))
    ).toBe(true);
    const ownDraft = (await readFormDrafts(page)).find((draft) =>
      draft.ownerUserId === data.profile.id
      && draft.locationId === locationId
      && draft.formType === "rubber-bill"
    );
    expect(ownDraft).toBeTruthy();
    expect(ownDraft?.data.weightDeduct).toBe(12);
    await page.evaluate(
      ({ draft, currentUserId, currentLocationId }) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("lanflow_form_drafts_db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("form_drafts", "readwrite");
          const store = transaction.objectStore("form_drafts");
          store.put({
            ...draft,
            key: JSON.stringify(["other-user", currentLocationId, "rubber-bill"]),
            ownerUserId: "other-user",
            data: { ...draft.data, customerSearch: "FOREIGN-USER-DRAFT" },
          });
          store.put({
            ...draft,
            key: JSON.stringify([currentUserId, "other-location", "rubber-bill"]),
            locationId: "other-location",
            data: { ...draft.data, customerSearch: "FOREIGN-LOCATION-DRAFT" },
          });
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
      {
        draft: ownDraft!,
        currentUserId: data.profile.id,
        currentLocationId: locationId,
      },
    );

    await page.reload();
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    const restoredModal = page.locator(".fixed.inset-0").last();
    const restoredWeighRow = restoredModal.locator("table tbody tr").first();

    await expect(restoredModal.locator('input[name="customerName"]')).toHaveValue(marker);
    await expect(restoredWeighRow.locator('input[type="number"]').nth(0)).toHaveValue("1250");
    await expect(restoredWeighRow.locator('input[type="number"]').nth(1)).toHaveValue("250");
    await expect(restoredWeighRow.locator('input[type="number"]').nth(3)).toHaveValue("27.5");
    await expect(restoredModal.getByLabel("หักน้ำหนักยาง (กก.)")).toHaveValue("12");
    await expect(restoredModal.getByLabel("หักน้ำหนักยาง (กก.)")).not.toBeFocused();
    await expect(restoredModal.locator('button[aria-controls="rubber-weight-deduction-field"]'))
      .toHaveAccessibleName("ยกเลิกหักน้ำหนัก");

    await expect.poll(() => readFormDrafts(page)).toContainEqual(expect.objectContaining({
      ownerUserId: data.profile.id,
      locationId,
      formType: "rubber-bill",
    }));

    page.once("dialog", (dialog) => void dialog.accept());
    await restoredModal.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(restoredModal).toBeHidden();
    await expect.poll(async () =>
      (await readFormDrafts(page)).filter((draft) =>
        draft.ownerUserId === data.profile.id
        && draft.locationId === locationId
        && draft.formType === "rubber-bill"
      )
    ).toEqual([]);
    await expect.poll(() => readFormDrafts(page)).toHaveLength(2);
  });

  test("restores an unsaved Income form after reload", async ({ page, context }) => {
    const marker = `DRAFT-INCOME-${Date.now()}`;

    const cashTab = page.getByRole("button", { name: /^รับ-จ่าย(?: |$)/ });
    await expect(cashTab).toBeVisible({ timeout: 15_000 });
    await cashTab.click();
    const addIncome = page.getByRole("button", { name: "เพิ่มรายรับ", exact: true });
    await expect(addIncome).toBeVisible({ timeout: 15_000 });
    await addIncome.click();
    const modal = page.locator(".fixed.inset-0").last();
    await expect(modal).toBeVisible();
    const line = modal.locator("table tbody tr").first();
    await expect(line.locator("input:not([type])")).toBeVisible();
    await line.locator("input:not([type])").fill(marker);
    await line.locator('input[type="number"]').last().fill("1.25");
    await page.waitForTimeout(500);

    await page.reload();
    await expect(cashTab).toBeVisible({ timeout: 15_000 });
    await cashTab.click();
    await expect(addIncome).toBeVisible({ timeout: 15_000 });
    await addIncome.click();
    const restoredModal = page.locator(".fixed.inset-0").last();
    const restoredLine = restoredModal.locator("table tbody tr").first();

    await expect(restoredLine.locator("input:not([type])")).toHaveValue(marker);
    await expect(restoredLine.locator('input[type="number"]').last()).toHaveValue("1.25");

    try {
      await context.setOffline(true);
      await restoredModal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
      await expect(restoredModal).toBeHidden();
      await expect.poll(() => readFormDrafts(page)).toEqual([]);

      await page.evaluate((draftMarker) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("lanflow_sync_db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("sync_queue", "readwrite");
          const store = transaction.objectStore("sync_queue");
          const cursorRequest = store.openCursor();
          cursorRequest.onerror = () => reject(cursorRequest.error);
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            if (cursor.value?.payload?.title === draftMarker) cursor.delete();
            cursor.continue();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }), marker);
    } finally {
      await context.setOffline(false).catch(() => {});
    }
  });
});
