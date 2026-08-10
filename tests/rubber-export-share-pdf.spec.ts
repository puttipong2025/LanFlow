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

  expect(inspection.pages).toBeGreaterThan(2);
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
  });
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

test("refreshes an open draft from the server when the window regains focus", async ({ page }) => {
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
  await expect.poll(() => draftRequests).toBe(2);
});

test("returns 404 for the removed Rubber Export print bookmark", async ({ page }) => {
  const response = await page.goto(`/rubber-exports/${verified.id}/print`);
  expect(response?.status()).toBe(404);
});
