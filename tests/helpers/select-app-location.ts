import type { Page } from "@playwright/test";

export async function selectAppLocation(page: Page, locationId: string) {
  await page.getByLabel(/^เลือกสาขา/).click();
  await page
    .locator(`[role="option"][data-location-id="${locationId}"]`)
    .click();
}

export async function selectAppLocationByIndex(page: Page, index: number) {
  await page.getByLabel(/^เลือกสาขา/).click();
  await page.getByRole("option").nth(index).click();
}

export async function selectedAppLocationId(page: Page) {
  return page.getByLabel(/^เลือกสาขา/).getAttribute("data-location-id");
}
