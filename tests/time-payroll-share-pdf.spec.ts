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
const outputPdf = path.join(outputDirectory, "LanFlow-time-payroll-withdrawal-slip-80mm.pdf");
const outputLongPdf = path.join(outputDirectory, "LanFlow-time-payroll-payroll-slip-long-80mm.pdf");
const bundledPython = "C:\\Users\\Do\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const longPayrollTransactions = Array.from({ length: 48 }, (_, index) => {
  const row = String(index + 1).padStart(3, "0");
  return {
    id: `row-${row}`,
    type: "DEBT",
    status: "APPROVED",
    amount: index + 1,
    description: `ROW-BEGIN-${row} รายการหักเงินสำหรับทดสอบการแบ่งหน้าของเอกสาร ROW-END-${row}`,
    effective_date: "2026-07-01",
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
    slip_data: {
      segments: [],
      transactions: longPayrollTransactions,
      outstandingAdjustments: {
        beforeDeductions: 3_176,
        deductedThisSlip: 2_000,
        remainingAfterDeductions: 1_176,
      },
      outstandingSources: [
        { id: "carried-debt", type: "DEBT", status: "APPROVED", amount: 2_000,
          effective_date: "2026-06-05", carried_forward: true, description: "ค่าซ่อมรถ CARRIED-BALANCE" },
        ...longPayrollTransactions,
      ],
    },
  },
  employeeName: "ผู้ใช้งานทั่วไป",
  generatedAt,
});

async function openTimeTracking(page: Page) {
  await page.route("**/api/lanflow", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== "/api/lanflow") return route.continue();
    await route.fulfill({
      json: {
        locations: [],
        profile: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "ผู้ใช้งานทั่วไป",
          phone: "0820000001",
          role: "user",
          isActive: true,
          locationIds: ["00000000-0000-4000-8000-000000000010"],
          primaryLocationId: "00000000-0000-4000-8000-000000000010",
          canManageTimePayroll: false,
        },
      },
    });
  });
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

test("previews an 80mm receipt with both signatures and shares the payroll PDF File", async ({ page }) => {
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
  await expect(dialog.getByText("3,000.00 บาท", { exact: true })).toBeVisible();
  await expect(dialog.getByText("หนี้และเงินเบิกก่อนหักรวม", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("หักรวมเดือนนี้", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("ยอดค้างยกไปเดือนถัดไป", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("1,176.00 บาท", { exact: true })).toBeVisible();
  await expect(dialog.getByText("หนี้ยกมา", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ค่าซ่อมรถ CARRIED-BALANCE", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "รายการหักเงิน", exact: true })).toHaveCount(0);
  await expect(dialog.getByText("1 ก.ค. 2569", { exact: true }).first()).toBeVisible();
  const preview = dialog.getByTestId("time-payroll-receipt-preview");
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())?.width).toBeCloseTo(302.36, 0);
  await expect(dialog.getByText("ผู้รับเงิน", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ผู้จ่ายเงิน", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __slipShare?: { name: string; size: number; title: string } }).__slipShare
  )).toMatchObject({
    name: "LanFlow-เงินเดือน-2026-07-b2c3d4e5-อนุมัติแล้ว-80mm.pdf",
    title: "สลิปเงินเดือน",
  });
  const shared = await page.evaluate(() =>
    (window as typeof window & { __slipShare?: { size: number } }).__slipShare
  );
  expect(shared?.size).toBeGreaterThan(1_000);
});

test("downloads a searchable single-page 80mm withdrawal PDF from the same preview", async ({ page }) => {
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
  expect(download.suggestedFilename()).toBe("LanFlow-เบิกเงิน-20260802-a1b2c3d4-รออนุมัติ-80mm.pdf");

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

  expect(inspection.pages).toBe(1);
  expect(inspection.width).toBeCloseTo(226.77, 1);
  expect(inspection.height).toBeGreaterThan(400);
  expect(inspection.height).toBeLessThan(14_400);
  const allText = inspection.actual.join("\n");
  expect(allText).toContain("สลิปเบิกเงิน");
  expect(allText).toContain("วันทำงานสะสม");
  expect(allText).toContain("ยอดเบิกที่ยังหักไม่หมด");
  expect(allText).toContain("ผู้รับเงิน");
  expect(allText).toContain("ผู้จ่ายเงิน");
  expect(allText).toContain(withdrawalId);
});

test("keeps every payroll transaction row on one long 80mm PDF page", async ({ page }) => {
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
      "page=reader.pages[0]",
      "print(json.dumps({'pages':len(reader.pages),'width':float(page.mediabox.width),'height':float(page.mediabox.height),'actual':actual},ensure_ascii=False))",
    ].join("\n"),
    outputLongPdf,
  ], { encoding: "utf8" })) as { pages: number; width: number; height: number; actual: string[] };

  expect(inspection.pages).toBe(1);
  expect(inspection.width).toBeCloseTo(226.77, 1);
  expect(inspection.height).toBeGreaterThan(1_000);
  expect(inspection.height).toBeLessThan(14_400);
  expect(inspection.actual[0]).toContain("ผู้รับเงิน");
  expect(inspection.actual[0]).toContain("ผู้จ่ายเงิน");
  expect(inspection.actual[0]).toContain(payrollId);
  expect(inspection.actual[0]).toContain("1 ก.ค. 2569");
  const pdfText = inspection.actual[0];
  expect(pdfText).toContain("หนี้ยกมา");
  expect(pdfText).toContain("ค่าซ่อมรถ CARRIED-BALANCE");
  expect(pdfText).toContain("หนี้และเงินเบิกก่อนหักรวม");
  expect(pdfText).toContain("ยอดค้างยกไปเดือนถัดไป");
  expect(pdfText.match(/หักรวมเดือนนี้/g)).toHaveLength(1);
  expect(pdfText.match(/ยอดค้างยกไปเดือนถัดไป/g)).toHaveLength(1);
  expect(pdfText.indexOf("สรุปยอด")).toBeGreaterThan(pdfText.indexOf("ROW-END-048"));
  for (let index = 1; index <= longPayrollTransactions.length; index += 1) {
    const row = String(index).padStart(3, "0");
    const startPage = inspection.actual.findIndex((text) => text.includes(`ROW-BEGIN-${row}`));
    const endPage = inspection.actual.findIndex((text) => text.includes(`ROW-END-${row}`));
    expect(startPage, `missing row ${row}`).toBeGreaterThanOrEqual(0);
    expect(endPage, `split row ${row}`).toBe(startPage);
  }
});

test("shows a compact zero-net payroll with a single bottom summary on mobile and PDF", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await openTimeTracking(page);
  const document = buildPayrollSlipDocument({
    source: {
      id: payrollId, month: "2026-07", status: "APPROVED",
      total_days: 20, daily_wage: 500, gross_pay: 10_000,
      total_deductions: 10_000, net_pay: 0, created_at: generatedAt,
      slip_data: {
        attendance: {
          month: "2026-07", workdayEndTime: "16:00", eligibleThrough: "2026-07-31",
          periods: [{ startOn: "2026-07-01", endOn: "2026-07-20" }], exceptions: [],
          summary: { fullDays: 20, halfDays: 0, offDays: 0, paidDays: 20, grossPay: 10_000 },
        },
        outstandingAdjustments: { beforeDeductions: 13_000, deductedThisSlip: 10_000, remainingAfterDeductions: 3_000 },
        outstandingSources: [
          { id: "debt", type: "DEBT", status: "APPROVED", carried_forward: true,
            effective_date: "2026-06-05", description: "ค่าซ่อมรถ", amount: 6_000 },
          { id: "withdrawal", type: "WITHDRAWAL", status: "APPROVED",
            effective_date: "2026-07-10", description: "ค่าใช้จ่ายส่วนตัว", amount: 7_000 },
        ],
      },
    },
    employeeName: "พนักงานตัวอย่าง", generatedAt,
  });
  await page.route(`**/api/lanflow/time-tracking/documents/payroll/${payrollId}`, (route) => route.fulfill({ json: document }));
  await page.getByRole("button", { name: "ดูสลิป", exact: true }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "สลิปเงินเดือน" });
  const preview = dialog.getByTestId("time-payroll-receipt-preview");
  await expect(preview).toBeVisible();
  await expect(dialog.getByText("0.00 บาท", { exact: true })).toHaveCount(1);
  const sections = await preview.locator("h4").allTextContents();
  expect(sections.indexOf("สรุปยอด")).toBeGreaterThan(sections.indexOf("รายละเอียดหนี้และเงินเบิก"));
  expect(await preview.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(path.join(outputDirectory, "LanFlow-payroll-debt-clarity-80mm.pdf"));
  await dialog.getByRole("heading", { name: "สรุปยอด", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDirectory, "LanFlow-payroll-debt-clarity-mobile.png") });
});

test("keeps the 80mm preview inside a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openTimeTracking(page);
  await page.getByRole("button", { name: "ดูสลิป", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "สลิปเบิกเงิน" });
  const preview = dialog.getByTestId("time-payroll-receipt-preview");
  await expect(preview).toBeVisible();
  const overflow = await preview.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(dialog.getByText("ผู้รับเงิน", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ผู้จ่ายเงิน", { exact: true })).toBeVisible();
});

test("normal payroll hides empty debt details and zero balances in Preview and PDF", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await openTimeTracking(page);
  const document = buildPayrollSlipDocument({
    source: {
      id: payrollId, month: "2026-07", status: "APPROVED", total_days: 20, daily_wage: 500,
      gross_pay: 10_000, total_deductions: 0, net_pay: 10_000, created_at: generatedAt,
      slip_data: {
        outstandingSources: [],
        outstandingAdjustments: { beforeDeductions: 0, deductedThisSlip: 0, remainingAfterDeductions: 0 },
        attendance: {
          month: "2026-07", workdayEndTime: "16:00", eligibleThrough: "2026-07-31",
          periods: [{ startOn: "2026-07-01", endOn: "2026-07-20" }], exceptions: [],
          summary: { fullDays: 20, halfDays: 0, offDays: 0, paidDays: 20, grossPay: 10_000 },
        },
      },
    },
    employeeName: "พนักงานตัวอย่าง", generatedAt,
  });
  await page.route(`**/api/lanflow/time-tracking/documents/payroll/${payrollId}`, (route) => route.fulfill({ json: document }));
  await page.getByRole("button", { name: "ดูสลิป", exact: true }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "สลิปเงินเดือน" });
  for (const label of ["รายละเอียดหนี้และเงินเบิก", "หนี้และเงินเบิกก่อนหักรวม", "ยอดค้างยกไปเดือนถัดไป", "ไม่มีรายการ"]) {
    await expect(dialog.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(dialog.getByText("หักรวมเดือนนี้", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("0.00 บาท", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("10,000.00 บาท", { exact: true })).toHaveCount(2);
  const preview = dialog.getByTestId("time-payroll-receipt-preview");
  expect(await preview.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "แชร์ PDF" }).click();
  const download = await downloadPromise;
  const normalPdf = path.join(outputDirectory, "LanFlow-payroll-normal-80mm.pdf");
  mkdirSync(outputDirectory, { recursive: true });
  await download.saveAs(normalPdf);
  const pdfText = execFileSync(bundledPython, ["-c", [
    "import sys",
    "from pypdf import PdfReader",
    "from pypdf.generic import ContentStream",
    "reader=PdfReader(sys.argv[1]); assert len(reader.pages)==1",
    "print('\\n'.join(str(args[1].get('/ActualText')) for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations if op==b'BDC' and len(args)>1 and hasattr(args[1],'get') and args[1].get('/ActualText') is not None))",
  ].join("\n"), normalPdf], { encoding: "utf8" });
  expect(pdfText).toContain("หักรวมเดือนนี้");
  expect(pdfText).toContain("0.00 บาท");
  expect(pdfText).toContain("เงินเดือนสุทธิที่ต้องจ่าย");
  expect(pdfText).not.toMatch(/รายละเอียดหนี้และเงินเบิก|หนี้และเงินเบิกก่อนหักรวม|ยอดค้างยกไปเดือนถัดไป|ไม่มีรายการ/);
  await dialog.getByRole("heading", { name: "สรุปยอด", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDirectory, "LanFlow-payroll-normal-mobile.png") });
});

for (const timezoneId of ["UTC", "Asia/Bangkok"]) {
  test(`payroll calendar starts on Wednesday for July 2026 in ${timezoneId}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId, storageState: "playwright/.auth/user.json" });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
      });
      await openTimeTracking(page);
      await page.getByRole("button", { name: "ดูสลิป", exact: true }).nth(1).click();
      const day = page.getByRole("dialog", { name: "สลิปเงินเดือน" }).locator('[aria-label="2026-07-01 ไม่ได้ทำงาน"]');
      await expect(day).toBeVisible();
      expect(await day.evaluate((element) => Array.from(element.parentElement!.children).indexOf(element))).toBe(3);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("dialog", { name: "สลิปเงินเดือน" }).getByRole("button", { name: "แชร์ PDF" }).click();
      const download = await downloadPromise;
      const pdfPath = path.join(outputDirectory, `LanFlow-payroll-calendar-${timezoneId.replace("/", "-")}.pdf`);
      mkdirSync(outputDirectory, { recursive: true });
      await download.saveAs(pdfPath);
      const firstDayX = Number(execFileSync(bundledPython, ["-c", [
        "import sys",
        "from pypdf import PdfReader",
        "from pypdf.generic import ContentStream",
        "reader=PdfReader(sys.argv[1]); current=None; positions=[]",
        "for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:\n if op==b'BDC' and len(args)>1 and hasattr(args[1],'get'): current=str(args[1].get('/ActualText'))\n elif op==b'Tm' and current=='1': positions.append(float(args[4])); current=None\n elif op==b'EMC': current=None",
        "print(positions[0])",
      ].join("\n"), pdfPath], { encoding: "utf8" }));
      const columnWidth = ((80 * 72 / 25.4) - 18) / 7;
      expect(firstDayX).toBeGreaterThanOrEqual(9 + 3 * columnWidth);
      expect(firstDayX).toBeLessThan(9 + 4 * columnWidth);
    } finally {
      await context.close();
    }
  });
}
