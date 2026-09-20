import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  longRubberExportDetails,
  rubberExportDetails,
} from "./rubber-export-pdf.fixture";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const verified = rubberExportDetails();
const longVerified = longRubberExportDetails();
const draft = rubberExportDetails({
  id: "rubber-export-draft-test",
  exportNo: "REX-20260729-ACTIVE-DRAFT",
  status: "draft",
  previousStatus: null,
  currentWeight: null,
  weightLossPercent: null,
  verifiedByName: null,
  verifiedAt: null,
});
const allDetails = [verified, longVerified, draft];
const outputDirectory = path.resolve("output/pdf");
const outputPdf = path.join(outputDirectory, "LanFlow-rubber-export-searchable-A4-landscape.pdf");
const bundledPython = "C:\\Users\\Do\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

async function openRubberExports(page: Page, options?: {
  detailStatus?: number;
  onDetail?: (id: string) => void;
}) {
  await page.route("**/api/lanflow/rubber-exports?*", (route) => route.fulfill({
    json: {
      exports: allDetails.map(({ items: _items, ...summary }) => summary),
      availableBills: [],
    },
  }));
  await page.route(/\/api\/lanflow\/rubber-exports\/([^/?]+)$/, (route) => {
    const id = route.request().url().split("/").pop() ?? "";
    options?.onDetail?.(id);
    const details = allDetails.find((item) => item.id === id);
    const status = options?.detailStatus ?? (details ? 200 : 404);
    return route.fulfill({
      status,
      contentType: "application/json",
      body: status === 200 && details
        ? JSON.stringify(details)
        : JSON.stringify({ error: "โหลดรายละเอียดรายการส่งออกไม่สำเร็จ" }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^ส่งออกยาง/ }).click();
  await expect(page.getByRole("heading", { name: /^ส่งออกยาง/ })).toBeVisible();
}

test("shares fresh details from both table and modal with filename and title", async ({ page }) => {
  const detailRequests: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        const target = window as typeof window & {
          __rubberExportShares?: Array<{ name: string; size: number; title: string }>;
        };
        target.__rubberExportShares ??= [];
        target.__rubberExportShares.push({
          name: file?.name ?? "",
          size: file?.size ?? 0,
          title: data.title ?? "",
        });
      },
    });
  });
  await openRubberExports(page, {
    onDetail: (id) => detailRequests.push(id),
  });

  const tableRow = page.locator("tr").filter({ hasText: verified.exportNo });
  await tableRow.getByRole("button", {
    name: `แชร์ PDF รายการส่งออกยาง ${verified.exportNo}`,
  }).click();
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __rubberExportShares?: unknown[] }).__rubberExportShares?.length
  )).toBe(1);

  await tableRow.getByRole("button", { name: `ดูรายละเอียด ${verified.exportNo}` }).click();
  await expect(page.getByRole("heading", {
    name: verified.exportNo,
    level: 2,
  })).toBeVisible();
  await page.getByRole("button", {
    name: `แชร์ PDF รายการส่งออกยาง ${verified.exportNo}`,
  }).last().click();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __rubberExportShares?: unknown[] }).__rubberExportShares?.length
  )).toBe(2);

  const shares = await page.evaluate(() =>
    (window as typeof window & {
      __rubberExportShares?: Array<{ name: string; size: number; title: string }>;
    }).__rubberExportShares ?? []
  );
  expect(shares[0]).toMatchObject({
    name: "LanFlow-rubber-export-REX-20260729-004-20260729-1504-A4-landscape.pdf",
    title: expect.stringContaining("REX-20260729-004 · สาขาทดสอบ PDF"),
  });
  expect(shares[0].size).toBeGreaterThan(1_000);
  expect(detailRequests).toEqual([
    verified.id,
    verified.id,
    verified.id,
  ]);
});

test("shows share only for verified status", async ({ page }) => {
  await openRubberExports(page);

  const draftRow = page.locator("tr").filter({ hasText: draft.exportNo });
  await expect(draftRow.getByRole("button", { name: /แชร์ PDF/ })).toHaveCount(0);
  await expect(page.locator("tr").filter({ hasText: verified.exportNo })
    .getByRole("button", { name: /แชร์ PDF/ })).toBeVisible();

  await expect(page.locator("tr").filter({ hasText: longVerified.exportNo })
    .getByRole("button", { name: /แชร์ PDF/ })).toBeVisible();
});

test("keeps the weight loss column readable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRubberExports(page);

  const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "น้ำหนักลดลง (%)" }) });
  const scroller = table.locator("..");
  await expect(table.getByRole("columnheader", { name: "น้ำหนักสุทธิรวม" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "น้ำหนักลดลง (%)" })).toBeVisible();
  const verifiedRow = table.getByRole("row").filter({ hasText: verified.exportNo });
  await expect(verifiedRow).toContainText("2.64%");
  await expect(verifiedRow).not.toContainText("฿28.72");
  const draftRow = table.getByRole("row").filter({ hasText: draft.exportNo });
  await expect(draftRow.getByRole("cell").nth(6)).toHaveText("—");
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(table.getByRole("columnheader", { name: "น้ำหนักลดลง (%)" })).toBeVisible();
  await table.getByRole("columnheader", { name: "น้ำหนักลดลง (%)" }).scrollIntoViewIfNeeded();
  mkdirSync(outputDirectory, { recursive: true });
  await page.screenshot({ path: path.join(outputDirectory, "rubber-export-narrow.png") });
});

test("shows each bill price in the requested detail column order on a wide screen", async ({ page }) => {
  await openRubberExports(page);
  await page.getByRole("button", { name: `ดูรายละเอียด ${verified.exportNo}` }).click();
  const detail = page.getByRole("dialog", { name: verified.exportNo });
  const table = detail.getByRole("table");
  await expect(table).toBeVisible();
  const headers = await table.getByRole("columnheader").allTextContents();
  expect(headers).toEqual([
    "วันที่บิล",
    "เลขบิล",
    "ลูกค้า",
    "น้ำหนักสุทธิ",
    "ราคาเฉลี่ย/กก.",
    "มูลค่ายาง",
    "อายุยาง",
  ]);
  const firstBill = table.getByRole("row").filter({ hasText: "RB-001" });
  await expect(firstBill).toContainText("฿29.00");
  await expect(firstBill).not.toContainText("฿30.00");
  const widths = await table.evaluate((element) => ({
    table: element.getBoundingClientRect().width,
    container: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(widths.table).toBeGreaterThanOrEqual(widths.container - 2);
  mkdirSync(outputDirectory, { recursive: true });
  await detail.screenshot({ path: path.join(outputDirectory, "rubber-export-detail-wide.png") });
});

test("keeps each bill price readable in the detail modal on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRubberExports(page);
  await page.getByRole("button", { name: `ดูรายละเอียด ${verified.exportNo}` }).click();

  const detail = page.getByRole("dialog", { name: verified.exportNo });
  const table = detail.getByRole("table");
  const scroller = table.locator("..");
  const priceHeader = table.getByRole("columnheader", { name: "ราคาเฉลี่ย/กก." });
  await expect(priceHeader).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "RB-001" })).toContainText("฿29.00");
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
  await priceHeader.scrollIntoViewIfNeeded();

  mkdirSync(outputDirectory, { recursive: true });
  await detail.screenshot({ path: path.join(outputDirectory, "rubber-export-detail-narrow.png") });
});

test("uses the Thai preview permission message from the route", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
  try {
    const response = await context.request.post("/api/lanflow/rubber-exports/preview", {
      data: {
        locationId: "00000000-0000-4000-8000-000000000001",
        selectedReportItemIds: ["00000000-0000-4000-8000-000000000002"],
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "ไม่มีสิทธิ์ดูตัวอย่างรายการของสาขานี้" });
  } finally {
    await context.close();
  }
});

test("downloads a searchable multi-page verified copy when file sharing is unsupported", async ({ page }) => {
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
  await openRubberExports(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("tr").filter({ hasText: longVerified.exportNo })
    .getByRole("button", {
      name: `แชร์ PDF รายการส่งออกยาง ${longVerified.exportNo}`,
    }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(outputPdf);

  expect(download.suggestedFilename()).toBe(
    "LanFlow-rubber-export-REX-20260729-060-20260729-1504-A4-landscape.pdf",
  );
  await expect(page.getByText("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว"))
    .toBeVisible();

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
      "fonts=[]",
      "for page in reader.pages:\n cs=ContentStream(page.get_contents(),reader)\n actual_texts.append('\\n'.join(str(operands[1].get('/ActualText')) for operands,operator in cs.operations if operator==b'BDC' and len(operands)>1 and hasattr(operands[1],'get') and operands[1].get('/ActualText') is not None))\n fonts.extend(str(font.get_object().get('/BaseFont')) for font in page['/Resources'].get('/Font',{}).values())",
      "print(json.dumps({'pages':len(pdf.pages),'width':pdf.pages[0].width,'height':pdf.pages[0].height,'texts':texts,'actualTexts':actual_texts,'fonts':fonts},ensure_ascii=False))",
    ].join("\n"),
    outputPdf,
  ], { encoding: "utf8" })) as {
    pages: number;
    width: number;
    height: number;
    texts: string[];
    actualTexts: string[];
    fonts: string[];
  };

  expect(inspection.pages).toBe(5);
  expect(inspection.width).toBeCloseTo(841.89, 1);
  expect(inspection.height).toBeCloseTo(595.28, 1);
  expect(inspection.fonts.join(" ")).toContain("NotoSansThai");
  inspection.actualTexts.forEach((text, index) => {
    expect(text).toContain(
      `${longVerified.exportNo} · หน้า ${index + 1}/${inspection.pages}`,
    );
  });
  const allText = inspection.actualTexts.join("\n");
  expect(allText).toContain("ตรวจสอบแล้ว");
  expect(allText).not.toContain("ลบแล้ว");
  expect(allText).toContain("น้ำหนักสุทธิรวม");
  expect(allText).toContain("มูลค่ายางรวม");
  expect(allText).toContain("ราคาจากบิล/กก.");
  expect(allText).toContain("ต้นทุนรวมค่าดำเนินการ");
  expect(allText).toContain("ราคาปัจจุบัน/กก.");
  expect(allText).toContain("ราคาจากบิล/กก. = มูลค่ายางรวม ÷ น้ำหนักสุทธิรวม");
  expect(allText).toContain("ราคาปัจจุบัน/กก. = (มูลค่ายางรวม + ค่าทำงานและค่าดำเนินการรวม) ÷ น้ำหนักปัจจุบัน");
  expect(allText).toContain("ผู้สร้าง");
  for (let index = 1; index <= 60; index += 1) {
    const row = String(index).padStart(3, "0");
    const billPage = inspection.actualTexts.findIndex((text) => text.includes(`RB-LONG-${row}`));
    const endPage = inspection.actualTexts.findIndex((text) => text.includes(`END-${row}`));
    expect(billPage, `missing RB-LONG-${row}`).toBeGreaterThanOrEqual(0);
    expect(endPage, `missing END-${row}`).toBe(billPage);
  }
  const itemPages = inspection.actualTexts.filter((text) => text.includes("RB-LONG-"));
  expect(itemPages.length).toBeGreaterThan(1);
  itemPages.forEach((text) => {
    expect(text).toContain("วันที่บิล");
    expect(text).toContain("เลขบิล");
    expect(text).toContain("ลูกค้า");
    expect(text).toContain("ราคาเฉลี่ย/กก.");
    expect(text).toContain("มูลค่ายาง");
  });
});

test("uses the three bill rubber values and matching totals in the verified PDF", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await openRubberExports(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("tr").filter({ hasText: verified.exportNo })
    .getByRole("button", { name: `แชร์ PDF รายการส่งออกยาง ${verified.exportNo}` }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  const threeBillPdf = path.join(outputDirectory, "LanFlow-rubber-export-three-bills.pdf");
  await download.saveAs(threeBillPdf);

  const actualText = execFileSync(bundledPython, [
    "-c",
    "import sys\nfrom pypdf import PdfReader\nfrom pypdf.generic import ContentStream\nr=PdfReader(sys.argv[1])\nfor p in r.pages:\n for operands,operator in ContentStream(p.get_contents(),r).operations:\n  if operator==b'BDC' and len(operands)>1 and hasattr(operands[1],'get'):\n   value=operands[1].get('/ActualText')\n   if value is not None: print(str(value))",
    threeBillPdf,
  ], { encoding: "utf8" });

  expect(actualText).toContain("฿8,703.00");
  expect(actualText).toContain("฿28.72");
  expect(actualText).toContain("฿9,277.50");
  expect(actualText).toContain("฿31.45");
  expect(actualText).toContain("2,900.00");
  expect(actualText).toContain("2,901.00");
  expect(actualText).toContain("2,902.00");
  expect(actualText).toContain("฿29.00");
  expect(actualText).toContain("฿28.45");
  expect(actualText).not.toContain("฿30.00");
  expect(actualText).not.toContain("3,000.00");
  expect(actualText).toContain("ผู้รับรอง");
  const actualLines = actualText.split(/\r?\n/);
  const netWeightHeader = actualLines.indexOf("น้ำหนักสุทธิ");
  const priceHeader = actualLines.indexOf("ราคาเฉลี่ย/กก.");
  const rubberValueHeader = actualLines.indexOf("มูลค่ายาง");
  expect(netWeightHeader).toBeGreaterThanOrEqual(0);
  expect(priceHeader).toBe(netWeightHeader + 1);
  expect(rubberValueHeader).toBe(priceHeader + 1);
});

test("cancels font loading and restores every share action", async ({ page }) => {
  await page.route("**/fonts/NotoSansThai-Regular.ttf", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await openRubberExports(page);
  const button = page.locator("tr").filter({ hasText: verified.exportNo })
    .getByRole("button", { name: /แชร์ PDF/ });

  await button.click();
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeHidden();
  await expect(button).toContainText("แชร์ PDF");
  await expect(button).toBeEnabled();
});

test("shows fresh-detail errors and recovers the share action", async ({ page }) => {
  await openRubberExports(page, { detailStatus: 500 });
  const button = page.locator("tr").filter({ hasText: verified.exportNo })
    .getByRole("button", { name: /แชร์ PDF/ });

  await button.click();

  await expect(page.getByText("โหลดรายละเอียดรายการส่งออกไม่สำเร็จ")).toBeVisible();
  await expect(button).toContainText("แชร์ PDF");
  await expect(button).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).toBeHidden();
});

test("does not refresh an open draft when the window regains focus", async ({ page }) => {
  let draftRequests = 0;
  await openRubberExports(page, {
    onDetail: (id) => {
      if (id === draft.id) draftRequests += 1;
    },
  });
  await page.getByRole("button", { name: `ดูรายละเอียด ${draft.exportNo}` }).click();
  await expect(page.getByRole("heading", { name: draft.exportNo, level: 2 })).toBeVisible();
  await expect.poll(() => draftRequests).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(300);
  expect(draftRequests).toBe(1);
});

test("returns 404 for the removed Rubber Export print bookmark", async ({ page }) => {
  const response = await page.goto(`/rubber-exports/${verified.id}/print`);
  expect(response?.status()).toBe(404);
});
