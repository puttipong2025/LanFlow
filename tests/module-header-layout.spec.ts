import { expect, type Page, test } from "@playwright/test";

type HeaderCase = {
  tab: RegExp;
  heading: RegExp;
  action: RegExp;
};

const headerCases: HeaderCase[] = [
  { tab: /^บิลยาง/, heading: /^รายการบิลยาง/, action: /^บัตรคิว$/ },
  { tab: /^ส่งออกยาง/, heading: /^ส่งออกยาง/, action: /^รีเฟรช$/ },
  { tab: /^รับ-จ่าย/, heading: /^CRUD รายรับ-รายจ่าย/, action: /^เพิ่มรายรับ$/ },
  { tab: /^สต็อกสินค้า/, heading: /^สต็อกสินค้า/, action: /^ซิงก์รายการ$/ },
  { tab: /^ลูกค้า/, heading: /^จัดการรายชื่อลูกค้า/, action: /^เพิ่มลูกค้าใหม่$/ },
  { tab: /^ขนส่งและพนักงาน/, heading: /^จัดการขนส่งและพนักงาน$/, action: /^เพิ่มขนส่งและพนักงานใหม่$/ },
  { tab: /^รายงาน/, heading: /^ชุดรายงาน/, action: /^รีเฟรช$/ },
  { tab: /^นับเงิน/, heading: /^นับเงิน/, action: /^รีเฟรช$/ },
];

async function assertHeaderStacksActions(page: Page, headerCase: HeaderCase) {
  await page.getByRole("button", { name: headerCase.tab }).click();
  const heading = page.getByRole("heading", { name: headerCase.heading });
  const action = page.getByRole("button", { name: headerCase.action });
  await expect(heading).toBeVisible();
  await expect(action).toBeVisible();

  const [headingBox, actionBox] = await Promise.all([
    heading.boundingBox(),
    action.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(headingBox!.y + headingBox!.height).toBeLessThan(actionBox!.y);
  expect(Math.abs(headingBox!.x - actionBox!.x)).toBeLessThanOrEqual(2);
}

test("stacks module header actions below the heading and aligns them left", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  for (const headerCase of headerCases) {
    await test.step(headerCase.heading.source, async () => {
      await assertHeaderStacksActions(page, headerCase);
    });
  }

  await test.step("อ่านใบชั่ง (OCR)", async () => {
    await page.getByRole("button", { name: "อ่านใบชั่ง", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "header-layout.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });

    const heading = page.getByRole("heading", { name: /^อ่านใบชั่ง \(OCR\)$/ });
    const action = page.getByRole("button", { name: /^ล้างรายการอัปโหลด$/ });
    await expect(action).toBeVisible();
    const [headingBox, actionBox] = await Promise.all([
      heading.boundingBox(),
      action.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(headingBox!.y + headingBox!.height).toBeLessThan(actionBox!.y);
    expect(Math.abs(headingBox!.x - actionBox!.x)).toBeLessThanOrEqual(2);
    await action.click();
  });
});
