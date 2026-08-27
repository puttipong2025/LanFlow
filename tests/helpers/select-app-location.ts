import type { Locator, Page } from "@playwright/test";

export async function selectAppLocation(page: Page, locationId: string) {
  await page.getByLabel(/^เลือกสาขา/).click();
  await page
    .locator(`[role="option"][data-location-id="${locationId}"]`)
    .click();
}

export async function selectedAppLocationId(page: Page) {
  return page.getByLabel(/^เลือกสาขา/).getAttribute("data-location-id");
}

export async function selectFirstAccessibleOption(page: Page, select: Locator) {
  const response = await page.request.get("/api/lanflow");
  if (!response.ok()) {
    throw new Error(`Unable to load accessible locations (${response.status()})`);
  }
  const bootstrap = await response.json() as {
    locations: Array<{ id: string }>;
    profile: { locationIds: string[] };
  };
  const accessibleIds = new Set(
    bootstrap.locations
      .filter((location) => bootstrap.profile.locationIds.includes(location.id))
      .map((location) => location.id),
  );
  const value = await select.locator("option").evaluateAll((options) =>
    options
      .map((option) => option as HTMLOptionElement)
      .filter((option) => !option.disabled && option.value)
      .map((option) => option.value),
  ).then((values) => values.find((value) => accessibleIds.has(value)));
  if (!value) throw new Error("No accessible target location option");
  await select.selectOption(value);
  return value;
}
