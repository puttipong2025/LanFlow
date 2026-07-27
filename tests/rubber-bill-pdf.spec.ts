import { expect, test, type Page } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildRubberBillReceiptModel,
  renderRubberBillReceiptHtml,
} from "../src/components/rubber-bills/bill-display";
import type { RubberBill } from "../src/types";

const downloadsDir = join(homedir(), "Downloads");
const offlinePdfPath = join(downloadsDir, "LanFlow-rubber-bill-offline-zero-price-80mm.pdf");
const syncedPdfPath = join(downloadsDir, "LanFlow-rubber-bill-synced-approved-80mm.pdf");

function makeBill(patch: Partial<RubberBill> = {}): RubberBill {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clientTempId: "pdf-client-1",
    localBillNo: "TEMP-PDF-001",
    serverBillNo: "2607250001",
    syncStatus: "synced",
    idempotencyKey: "server:pdf-1",
    locationId: "22222222-2222-4222-8222-222222222222",
    billNo: "2607250001",
    billDate: "2026-07-25",
    customerName: "ลูกค้าทดสอบใบพิมพ์",
    billType: "บิลเครื่องชั่งเล็ก",
    deductWeight: 2,
    weight: 850,
    netWeight: 848,
    weighValueTotal: 17_000,
    rubberValue: 16_960,
    price: 20,
    deductionTotal: 140,
    payableBeforeRounding: 16_820,
    netTotal: 16_820,
    acidPackCount: 2,
    configuredPriceSnapshot: 20,
    approvalState: "approved",
    approvalApprovedByName: "หัวหน้าสาขา",
    approvalRevisionNo: 3,
    weighItems: [
      {
        id: "weigh-1",
        label: "ชั่ง1",
        inWeight: 1_000,
        outWeight: 200,
        netWeight: 800,
        price: 20,
      },
      {
        id: "weigh-2",
        label: "ชั่ง2",
        inWeight: 120,
        outWeight: 70,
        netWeight: 50,
        price: 20,
      },
    ],
    acidItems: [{
      id: "stock-1",
      name: "กรดฟอร์มิก",
      stockProductId: "product-1",
      quantity: 2,
      unit: "ขวด",
      unitPrice: 50,
    }],
    debtItems: [{ id: "debt-1", title: "หักชำระหนี้", amount: 40 }],
    createdByUserId: "user-1",
    createdByName: "พนักงานผู้สร้างบิล",
    createdByPhone: "",
    clientCreatedAt: "2026-07-25T10:00:00.000Z",
    clientRecordedAt: "2026-07-25T10:00:00.000Z",
    serverReceivedAt: "2026-07-25T10:00:01.000Z",
    revisionNo: 3,
    recordStatus: "active",
    ...patch,
  };
}

async function saveReceiptPdf(
  page: Page,
  bill: RubberBill,
  outputPath: string
) {
  await page.setContent(
    renderRubberBillReceiptHtml(buildRubberBillReceiptModel(bill)),
    { waitUntil: "load" }
  );
  await page.emulateMedia({ media: "print" });
  const height = await page.evaluate(() =>
    Math.ceil(document.body.getBoundingClientRect().height + 24)
  );
  await page.pdf({
    path: outputPath,
    width: "80mm",
    height: `${height}px`,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    printBackground: true,
  });
}

test("saves verified 80mm Rubber Bill PDFs to Downloads", async ({ page }) => {
  await mkdir(downloadsDir, { recursive: true });

  await saveReceiptPdf(page, makeBill({
    serverBillNo: undefined,
    syncStatus: "pending",
    price: 0,
    weighValueTotal: 0,
    rubberValue: 0,
    deductionTotal: 0,
    payableBeforeRounding: 0,
    netTotal: 0,
    approvalState: "not_required",
    approvalApprovedByName: null,
    approvalRevisionNo: null,
    weighItems: [{
      id: "weigh-zero",
      label: "ชั่ง1",
      inWeight: 1_000,
      outWeight: 200,
      netWeight: 800,
      price: 0,
    }],
    acidItems: [],
    debtItems: [],
  }), offlinePdfPath);

  await saveReceiptPdf(page, makeBill(), syncedPdfPath);

  expect((await stat(offlinePdfPath)).size).toBeGreaterThan(1_000);
  expect((await stat(syncedPdfPath)).size).toBeGreaterThan(1_000);
});
