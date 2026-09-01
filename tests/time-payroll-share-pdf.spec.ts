import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  buildPayrollSlipDocument,
  buildWithdrawalSlipDocument,
  type TimePayrollSlipDocument,
} from "@/lib/time-tracking/slip-document";

test.use({ storageState: "playwright/.auth/user.json" });

const withdrawalId = "a1b2c3d4-1111-4111-8111-123456789abc";
const payrollId = "b2c3d4e5-2222-4222-8222-123456789abc";
const generatedAt = "2026-08-02T03:04:05.000Z";
const outputDirectory = path.resolve("output/pdf");
const outputPdf = path.join(outputDirectory, "LanFlow-time-payroll-slip-A4-portrait.pdf");
const outputLongPdf = path.join(outputDirectory, "LanFlow-payroll-slip-multi-page.pdf");
const bundledPython = "C:\\Users\\Do\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const longPayrollTransactions = Array.from({ length: 48 }, (_, index) => {
  const row = String(index + 1).padStart(3, "0");
  return {
    id: `row-${row}`,
    type: "DEBT_DEDUCTION",
    status: "APPROVED",
    amount: index + 1,
    description: `ROW-BEGIN-${row} รายการหักเงินสำหรับทดสอบการแบ่งหน้าของเอกสาร ROW-END-${row}`,
    applied_month: "2026-07-01",
  };
});

const withdrawalDocument = buildWithdrawalSlipDocument({
  source: {
    id: withdrawalId,
    status: "PENDING",
    amount: 7_000,
    remaining_amount: 7_000,
    effective_date: "2026-08-02",
    created_at: "2026-08-02T01:00:00.000Z",
    description: "เบิกล่วงหน้า",
  },
  employeeName: "ผู้ใช้งานทั่วไป",
  dailyWage: 500,
  totalPaidDays: 10,
  existingDeductions: 0,
  segments: [],
  generatedAt,
});

const payrollDocument = buildPayrollSlipDocument({
  source: {
    id: payrollId,
    month: "2026-07",
    status: "APPROVED",
    total_days: 10,
    daily_wage: 500,
    gross_pay: 5_000,
    total_deductions: 2_000,
    net_pay: 3_000,
    created_at: "2026-08-01T01:00:00.000Z",
    approved_at: "2026-08-02T01:00:00.000Z",
    approver_name: "ผู้อนุมัติ",
    payment_label: "จ่ายโดยสาขาหลัก",
    slip_data: { segments: [], transactions: longPayrollTransactions },
  },
  employeeName: "ผู้ใช้งานทั่วไป",
  generatedAt,
});

async function openTimeTracking(page: Page) {
  await page.route("**/api/lanflow/time-tracking/user?*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== "/api/lanflow/time-tracking/user") return route.continue();
    await route.fulfill({
      json: {
        timeTracking: { status: "PAUSED", start_time: null, resume_schedule: null },
        wageInfo: { totalDays: 10, grossPay: 5_000, remainingBalance: 0, totalDebt: 7_000 },
        debts: [],
        deductions: [],
        transactions: [
          {
            id: withdrawalId,
            type: "WITHDRAWAL",
            amount: 7_000,
            remaining_amount: 7_000,
            effective_date: "2026-08-02",
            created_at: "2026-08-02T01:00:00.000Z",
            status: "PENDING",
            description: "เบิกล่วงหน้า",
          },
          {
            id: "c3d4e5f6-3333-4333-8333-123456789abc",
            type: "WITHDRAWAL",
            amount: 500,
            effective_date: "2026-08-01",
            created_at: "2026-08-01T01:00:00.000Z",
            status: "REJECTED",
          },
        ],
        slips: [
          { id: payrollId, month: "2026-07", gross_pay: 5_000, total_deductions: 2_000, net_pay: 3_000, status: "APPROVED" },
          { id: "d4e5f607-4444-4444-8444-123456789abc", month: "2026-06", gross_pay: 4_000, total_deductions: 0, net_pay: 4_000, status: "REJECTED" },
          { id: "e5f60718-5555-4555-8555-123456789abc", month: "2026-05", gross_pay: 4_000, total_deductions: 0, net_pay: 4_000, status: "APPROVED", cancelled_at: "2026-08-01T00:00:00.000Z" },
        ],
      },
    });
  });
  await page.route("**/api/lanflow/time-tracking/documents/*/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const document: TimePayrollSlipDocument = pathname.includes("/withdrawal/")
      ? withdrawalDocument
      : payrollDocument;
    await route.fulfill({ json: document });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ระบบเวลาและเงินเดือน/ })).toBeVisible();
}

test("previews only eligible sources and shares the payroll PDF File", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        (window as typeof window & { __slipShare?: { name: string; size: number; title: string } }).__slipShare = {
          name: file?.name || "",
          size: file?.size || 0,
          title: data.title || "",
        };
      },
    });
  });
  await openTimeTracking(page);

  const previewButtons = page.getByRole("button", { name: "ดูสลิป", exact: true });
  await expect(previewButtons).toHaveCount(2);
  await previewButtons.nth(1).click();
  const dialog = page.getByRole("dialog", { name: "สลิปเงินเดือน" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("3,000 บาท", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __slipShare?: { name: string; size: number; title: string } }).__slipShare
  )).toMatchObject({
    name: "LanFlow-เงินเดือน-2026-07-b2c3d4e5-อนุมัติแล้ว.pdf",
    title: "สลิปเงินเดือน",
  });
  const shared = await page.evaluate(() =>
    (window as typeof window & { __slipShare?: { size: number } }).__slipShare
  );
  expect(shared?.size).toBeGreaterThan(1_000);
});

test("downloads a searchable A4 portrait withdrawal PDF from the same preview", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await openTimeTracking(page);

  await page.getByRole("button", { name: "ดูสลิป", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "สลิปเบิกเงิน" });
  await expect(dialog.getByText("วันทำงานสะสม")).toBeVisible();
  await expect(dialog.getByText("ยอดเบิกที่ยังหักไม่หมด")).toBeVisible();
  await expect(dialog.getByText("2,000 บาท", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(outputPdf);
  expect(download.suggestedFilename()).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-รออนุมัติ.pdf");

  const inspection = JSON.parse(execFileSync(bundledPython, [
    "-c",
    [
      "import json,sys,pdfplumber",
      "from pypdf import PdfReader",
      "from pypdf.generic import ContentStream",
      "pdf=pdfplumber.open(sys.argv[1])",
      "reader=PdfReader(sys.argv[1])",
      "actual=[]",
      "for page in reader.pages:\n cs=ContentStream(page.get_contents(),reader)\n actual.append('\\n'.join(str(operands[1].get('/ActualText')) for operands,operator in cs.operations if operator==b'BDC' and len(operands)>1 and hasattr(operands[1],'get') and operands[1].get('/ActualText') is not None))",
      "print(json.dumps({'pages':len(pdf.pages),'width':pdf.pages[0].width,'height':pdf.pages[0].height,'actual':actual},ensure_ascii=False))",
    ].join("\n"),
    outputPdf,
  ], { encoding: "utf8" })) as { pages: number; width: number; height: number; actual: string[] };

  expect(inspection.pages).toBeGreaterThanOrEqual(1);
  expect(inspection.width).toBeCloseTo(595.28, 1);
  expect(inspection.height).toBeCloseTo(841.89, 1);
  const allText = inspection.actual.join("\n");
  expect(allText).toContain("สลิปเบิกเงิน");
  expect(allText).toContain("วันทำงานสะสม");
  expect(allText).toContain("ยอดเบิกที่ยังหักไม่หมด");
  inspection.actual.forEach((text, index) => {
    expect(text).toContain(`${withdrawalId} · หน้า ${index + 1}/${inspection.pages}`);
  });
});

test("keeps every payroll transaction row on one page in a multi-page PDF", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await openTimeTracking(page);
  await page.getByRole("button", { name: "ดูสลิป", exact: true }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "สลิปเงินเดือน" });

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(outputLongPdf);

  const inspection = JSON.parse(execFileSync(bundledPython, [
    "-c",
    [
      "import json,sys",
      "from pypdf import PdfReader",
      "from pypdf.generic import ContentStream",
      "reader=PdfReader(sys.argv[1])",
      "actual=[]",
      "for page in reader.pages:\n cs=ContentStream(page.get_contents(),reader)\n actual.append('\\n'.join(str(operands[1].get('/ActualText')) for operands,operator in cs.operations if operator==b'BDC' and len(operands)>1 and hasattr(operands[1],'get') and operands[1].get('/ActualText') is not None))",
      "print(json.dumps({'pages':len(reader.pages),'actual':actual},ensure_ascii=False))",
    ].join("\n"),
    outputLongPdf,
  ], { encoding: "utf8" })) as { pages: number; actual: string[] };

  expect(inspection.pages).toBeGreaterThan(1);
  inspection.actual.forEach((text, index) => {
    expect(text).toContain(`${payrollId} · หน้า ${index + 1}/${inspection.pages}`);
  });
  for (let index = 1; index <= longPayrollTransactions.length; index += 1) {
    const row = String(index).padStart(3, "0");
    const startPage = inspection.actual.findIndex((text) => text.includes(`ROW-BEGIN-${row}`));
    const endPage = inspection.actual.findIndex((text) => text.includes(`ROW-END-${row}`));
    expect(startPage, `missing row ${row}`).toBeGreaterThanOrEqual(0);
    expect(endPage, `split row ${row}`).toBe(startPage);
  }
});
