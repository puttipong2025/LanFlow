import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import PDFDocument from "pdfkit/js/pdfkit.standalone";
import { loadSourceModule } from "../helpers/load-source-module";
import type { createCashCountPdf } from "../../src/lib/cash-count-pdf";

test("real Thai 80mm renderer produces a receipt with signature space", async () => {
  const module = loadSourceModule<{ createCashCountPdf: typeof createCashCountPdf }>("src/lib/cash-count-pdf.ts", {
    "pdfkit/js/pdfkit.standalone": { default: PDFDocument },
  }, { Blob, Uint8Array, ArrayBuffer, DOMException,
    fetch: async (url: string) => new Response(readFileSync(`public${url.split("?")[0]}`)),
  });
  const file = await module.createCashCountPdf({ id: "sample", reportNo: "CNT-20261024-000001",
    locationId: "sample", locationName: "สาขาตัวอย่าง", cutoffAt: "2026-10-24T10:00:00Z", createdAt: "2026-10-24T10:15:00Z",
    actualCounts: { "1000": 50, "500": 20, "100": 80, "50": 20, "20": 40, "10": 10, "5": 10, "2": 20, "1": 10 },
    actualTotal: 70000, accountBalance: 29500, countedTotal: 99500, systemBalance: 100000, differenceTotal: -500,
    bankAccounts: [{ id: "1", position: 1, amount: 10000 }, { id: "2", position: 2, amount: 10000 },
      { id: "3", position: 3, amount: 5000 }, { id: "4", position: 4, amount: 4500 }],
    checkedByName: "มานะ ตรวจดี", checkedAt: "2026-10-24T10:20:00Z", createdByName: "สมชาย ใจดี",
    status: "active", formulaVersion: "ledger-v2", deletedAt: null, hasBankAccount: true,
  }, new AbortController().signal);
  expect(file.type).toBe("application/pdf");
  expect(file.size).toBeGreaterThan(10000);
  mkdirSync("output/pdf", { recursive: true });
  writeFileSync("output/pdf/cash-count-sample-80mm.pdf", Buffer.from(await file.arrayBuffer()));
  expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
});
