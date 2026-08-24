import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { longReportDetails } from "./report-pdf.fixture";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const details = longReportDetails();
const outputDirectory = path.resolve("output/pdf");
const outputPdf = path.join(outputDirectory, "LanFlow-report-searchable-A4-landscape.pdf");
const bundledPython = "C:\\Users\\Do\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

async function openReports(
  page: Page,
  detailStatus = 200,
  onDetailRequest?: () => void,
  detailDelayMs = 0,
) {
  await page.route("**/api/lanflow/reports?*", (route) => route.fulfill({
    json: { reports: [details.report] },
  }));
  await page.route("**/api/lanflow/reports/report-share-test", (route) => {
    onDetailRequest?.();
    return new Promise((resolve) => setTimeout(resolve, detailDelayMs)).then(() => route.fulfill({
      status: detailStatus,
      contentType: "application/json",
      body: detailStatus === 200
        ? JSON.stringify(details)
        : JSON.stringify({ error: "โหลดรายละเอียดรายงานไม่สำเร็จ" }),
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "รายงาน", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ชุดรายงาน/ })).toBeVisible();
  await expect(page.getByRole("button", {
    name: `ดูรายงาน ${details.report.reportNo}`,
  })).toBeVisible();
}

async function openPreview(page: Page) {
  await page.getByRole("button", {
    name: `ดูรายงาน ${details.report.reportNo}`,
  }).click();
  const preview = page.getByRole("dialog", { name: "ชุดรายงาน LanFlow" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("1. บิลยาง", { exact: true })).toBeVisible();
  return preview;
}

test("shares a searchable report File with a human-readable title", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        (window as typeof window & {
          __reportShare?: { name: string; size: number; title: string };
        }).__reportShare = {
          name: file?.name ?? "",
          size: file?.size ?? 0,
          title: data.title ?? "",
        };
      },
    });
  });
  await openReports(page);
  const preview = await openPreview(page);

  await preview.getByRole("button", { name: "แชร์ PDF" }).click();
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "แชร์ PDF" }))
    .toContainText("กำลังสร้าง PDF");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __reportShare?: { name: string; size: number; title: string };
    }).__reportShare
  )).toMatchObject({
    name: "LanFlow-report-RPT-20260729-004-20260729-1504-A4-landscape.pdf",
    title: expect.stringContaining("RPT-20260729-004 · สาขาทดสอบ PDF"),
  });
  const share = await page.evaluate(() =>
    (window as typeof window & {
      __reportShare?: { name: string; size: number; title: string };
    }).__reportShare
  );
  expect(share?.size).toBeGreaterThan(1_000);
  await expect(page.getByText(`แชร์ ${details.report.reportNo} แล้ว`)).toBeVisible();
  await expect(preview).toBeVisible();
});

test("recovers from a stale non-font response in the PDF font cache", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.route("**/fonts/NotoSansThai-Regular.ttf", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><title>stale app shell</title>",
  }));
  await openReports(page);
  const preview = await openPreview(page);

  await preview.getByRole("button", { name: "แชร์ PDF" }).click();

  await expect(page.getByText(`แชร์ ${details.report.reportNo} แล้ว`)).toBeVisible();
  await expect(page.getByText("Unknown font format", { exact: true })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "แชร์ PDF" })).toBeEnabled();
});

test("shows a useful error when both PDF font responses are invalid", async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith("/fonts/") && url.pathname.endsWith(".ttf"),
    (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>invalid font response</title>",
    }),
  );
  await openReports(page);
  const preview = await openPreview(page);

  await preview.getByRole("button", { name: "แชร์ PDF" }).click();

  await expect(page.getByText(
    "โหลดฟอนต์ภาษาไทยสำหรับ PDF ไม่สำเร็จ กรุณาลองใหม่",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("Unknown font format", { exact: true })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "แชร์ PDF" })).toBeEnabled();
});

test("cancels font loading and restores the report action", async ({ page }) => {
  await page.route("**/fonts/NotoSansThai-Regular.ttf", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await openReports(page);
  const preview = await openPreview(page);
  const button = preview.getByRole("button", { name: "แชร์ PDF" });

  await button.click();
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeHidden();
  await expect(button).toContainText("แชร์ PDF");
  await expect(button).toBeEnabled();
});

test("downloads an actual multi-page PDF when file sharing is unsupported", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new Error("navigator.share should not be called");
      },
    });
  });
  await openReports(page);
  const preview = await openPreview(page);

  const downloadPromise = page.waitForEvent("download");
  await preview.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(outputPdf);

  expect(download.suggestedFilename()).toBe(
    "LanFlow-report-RPT-20260729-004-20260729-1504-A4-landscape.pdf"
  );
  await expect(page.getByText("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว"))
    .toBeVisible();
  await expect(preview).toBeVisible();

  const inspection = JSON.parse(execFileSync(bundledPython, [
    "-c",
    [
      "import json,sys,pdfplumber",
      "from pypdf import PdfReader",
      "from pypdf.generic import ContentStream",
      "pdf=pdfplumber.open(sys.argv[1])",
      "texts=[page.extract_text() or '' for page in pdf.pages]",
      "reader=PdfReader(sys.argv[1])",
      "actual_texts=[]",
      "for page in reader.pages:\n cs=ContentStream(page.get_contents(),reader)\n actual_texts.append('\\n'.join(str(operands[1].get('/ActualText')) for operands,operator in cs.operations if operator==b'BDC' and len(operands)>1 and hasattr(operands[1],'get') and operands[1].get('/ActualText') is not None))",
      "print(json.dumps({'pages':len(pdf.pages),'width':pdf.pages[0].width,'height':pdf.pages[0].height,'texts':texts,'actualTexts':actual_texts},ensure_ascii=False))",
    ].join("\n"),
    outputPdf,
  ], { encoding: "utf8" })) as {
    pages: number;
    width: number;
    height: number;
    texts: string[];
    actualTexts: string[];
  };

  expect(inspection.pages).toBeGreaterThan(2);
  expect(inspection.width).toBeCloseTo(841.89, 1);
  expect(inspection.height).toBeCloseTo(595.28, 1);
  expect(inspection.actualTexts).toHaveLength(inspection.pages);
  inspection.actualTexts.forEach((text, index) => {
    expect(text).toContain(`RPT-20260729-004 · หน้า ${index + 1}/${inspection.pages}`);
  });
  expect(inspection.texts.join("\n")).not.toContain("\u0000");
  const allText = inspection.actualTexts.join("\n");
  expect(allText).toContain("สถานะ: ใช้งาน");
  expect(allText).not.toContain("ลบแล้ว");
  expect(allText).toContain("มีผลตรวจนับเงินสด");
  expect(allText).toContain("ผู้ตรวจนับทดสอบ");
  expect(allText).not.toContain("คะแนนพิรุธ");
  expect(allText).not.toContain("ความเชื่อมั่น");
  expect(allText).toContain("1.1 ผู้ค้าขาย");
  expect(allText).toContain("1.2 ชาวสวน");
  expect(allText).toContain("2. รับ-จ่ายรวม");
  expect(allText).toContain("3. สต็อกสินค้า");
  expect(allText).toContain("4. เวลาและเงินเดือน");
  expect(allText).toContain("5. โอนเงิน (ธนาคารเท่านั้น)");
  expect(allText).toContain("ยอดคงเหลือสุทธิ");

  for (let index = 1; index <= 72; index += 1) {
    const row = String(index).padStart(3, "0");
    const numberPage = inspection.actualTexts.findIndex((text) => text.includes(`LEDGER-${row}`));
    const endPage = inspection.actualTexts.findIndex((text) => text.includes(`END-${row}`));
    expect(numberPage, `missing LEDGER-${row}`).toBeGreaterThanOrEqual(0);
    expect(endPage, `missing END-${row}`).toBe(numberPage);
  }
  const ledgerPages = inspection.actualTexts.filter((text) => text.includes("LEDGER-"));
  expect(ledgerPages.length).toBeGreaterThan(1);
  ledgerPages.forEach((text) => {
    expect(text).toContain("วันที่");
    expect(text).toContain("เลขที่");
    expect(text).toContain("รายการ");
    expect(text).toContain("รายรับ");
    expect(text).toContain("รายจ่าย");
  });
});

test("shows detail errors inside the preview without a share action", async ({ page }) => {
  await openReports(page, 500);
  await page.getByRole("button", {
    name: `ดูรายงาน ${details.report.reportNo}`,
  }).click();
  const preview = page.getByRole("dialog", { name: "พรีวิวรายงาน" });

  await expect(preview.getByText("โหลดรายละเอียดรายงานไม่สำเร็จ")).toBeVisible();
  await expect(preview.getByRole("button", { name: "แชร์ PDF" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeHidden();

  await preview.getByRole("button", { name: "ปิด" }).click();
  await page.unroute("**/api/lanflow/reports/report-share-test");
  await page.route("**/api/lanflow/reports/report-share-test", (route) => route.fulfill({ json: details }));
  await openPreview(page);
});

test("loads one detail object for preview and sharing", async ({ page }) => {
  let detailRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await openReports(page, 200, () => { detailRequests += 1; });
  const preview = await openPreview(page);

  expect(detailRequests).toBe(1);
  await preview.getByRole("button", { name: "แชร์ PDF" }).click();
  await expect(page.getByText(`แชร์ ${details.report.reportNo} แล้ว`)).toBeVisible();
  expect(detailRequests).toBe(1);
  await expect(preview.getByText("ใช้งาน", { exact: true })).toBeVisible();
  await expect(preview.getByRole("button", { name: "เปิดผลนับ" })).toHaveCount(0);
  await expect(preview.getByText("คะแนนพิรุธ")).toHaveCount(0);
  await expect(preview.getByText("ความเชื่อมั่น")).toHaveCount(0);
});

test("previews an active report with its current status", async ({ page }) => {
  const activeDetails = structuredClone(details);
  activeDetails.report.status = "active";
  activeDetails.report.deletedAt = null;
  await page.route("**/api/lanflow/reports?*", (route) => route.fulfill({
    json: { reports: [activeDetails.report] },
  }));
  await page.route("**/api/lanflow/reports/report-share-test", (route) => route.fulfill({
    json: activeDetails,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "รายงาน", exact: true }).click();
  await page.getByRole("button", {
    name: `ดูรายงาน ${activeDetails.report.reportNo}`,
  }).click();

  const preview = page.getByRole("dialog", { name: "ชุดรายงาน LanFlow" });
  await expect(preview.getByText("ใช้งาน", { exact: true })).toBeVisible();
  await expect(preview.getByText("ลบแล้ว (สำเนา)")).toHaveCount(0);
});

test("shows a structural loading state and horizontally scrollable report tables on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReports(page, 200, undefined, 500);

  await page.getByRole("button", {
    name: `ดูรายงาน ${details.report.reportNo}`,
  }).click();
  const loadingPreview = page.getByRole("dialog", { name: "พรีวิวรายงาน" });
  await expect(loadingPreview.getByRole("status", { name: "กำลังโหลดรายงาน" })).toBeVisible();

  const preview = page.getByRole("dialog", { name: "ชุดรายงาน LanFlow" });
  await expect(preview).toBeVisible();
  for (const title of [
    "1. บิลยาง",
    "2. รับ–จ่ายรวม",
    "3. สต็อกสินค้า",
    "4. เวลาและเงินเดือน",
    "5. โอนเงิน (ธนาคารเท่านั้น)",
  ]) {
    await expect(preview.getByText(title, { exact: true })).toBeVisible();
  }
  const firstTableScroller = preview.locator("div.overflow-x-auto").first();
  await expect.poll(() => firstTableScroller.evaluate((element) =>
    element.scrollWidth > element.clientWidth
  )).toBe(true);
});
