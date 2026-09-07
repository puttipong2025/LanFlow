import type { Locator, Page } from "@playwright/test";

export async function selectAppLocation(page: Page, locationId: string) {
  await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click();
  await page
    .locator(`[role="option"][data-location-id="${locationId}"]`)
    .click();
}

export async function selectedAppLocationId(page: Page) {
  return page
    .locator('button[data-location-id][aria-controls="location-selector-listbox"]')
    .getAttribute("data-location-id");
}

export async function confirmCurrentBranchIfRequired(page: Page) {
  const guard = page.getByRole("alertdialog", { name: "ยืนยันสาขาก่อนสร้างรายการ" });
  const appeared = await guard.waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  const selector = page.locator('button[data-location-id][aria-controls="location-selector-listbox"]');
  const locationId = await selector.getAttribute("data-location-id");
  const response = await page.request.get("/api/lanflow");
  if (!response.ok()) throw new Error(`Unable to load current location (${response.status()})`);
  const bootstrap = await response.json() as { locations: Array<{ id: string; name: string }> };
  const locationName = bootstrap.locations.find((location) => location.id === locationId)?.name;
  if (!locationName) throw new Error("Current location name is missing from the bootstrap response");

  await guard.getByRole("button", {
    name: `เลือกสาขา ${locationName}`,
    exact: true,
  }).click();
  await guard.waitFor({ state: "hidden" });
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
