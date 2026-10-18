import type { Page } from "@playwright/test";
export async function dismissRubberWeightAlertIfVisible(page: Page) {
  const dialog = page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true });
  if (!await dialog.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false)) return;
  await dialog.getByRole("button", { name: "รับทราบ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
