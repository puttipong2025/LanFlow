import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSourceModule } from "./helpers/load-source-module";
import { rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import type { SyncEvent } from "../src/lib/idb-queue";

test("problem rows expose the full cause and enable editing only for correctable rejections", async ({ page }) => {
  const { RubberBillsTable } = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillsTable")>("src/components/rubber-bills/RubberBillsTable.tsx", {});
  const errorMessage = "ข้อมูลน้ำหนักไม่ถูกต้อง กรุณาตรวจสอบรายการชั่งก่อนส่งใหม่";
  const event: SyncEvent = {
    id: "local", entity: "rubber_bills", ownerUserId: "owner", locationId: "location",
    operation: "update", serverId: "71000000-0000-4000-8000-000000000021", timestamp: 1,
    status: "failed", failureHttpStatus: 400, errorMessage,
    payload: { clientTempId: "local", locationId: "location", expectedRevisionNo: 3, items: [] },
  };
  const bill = rubberBillFromSyncEvent(event, "owner")!;
  const noop = () => {};
  const props = { bills: [bill], page: 1, pageSize: 10, onPageChange: noop, onView: noop, onEvidence: noop, onEdit: noop, onDelete: noop, onPrint: noop, onRetry: noop, onDiscardLocal: noop, onOpenOcrSourceImage: noop, retryDisabled: false, discardDisabled: false, evidenceStatesByBillId: new Map(), evidenceOnline: true };
  await page.setContent(renderToStaticMarkup(createElement(RubberBillsTable, props)));
  await expect(page.getByRole("button", { name: "แก้ไข", exact: true })).toBeEnabled();
  await expect(page.getByText(errorMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ทิ้งรายการค้างในเครื่อง", exact: true })).toBeEnabled();
  await page.setContent(renderToStaticMarkup(createElement(RubberBillsTable, { ...props, bills: [{ ...bill, canCorrectSyncFailure: false }] })));
  await expect(page.getByRole("button", { name: "ทิ้งรายการค้างในเครื่องก่อนแก้ไขหรือลบ", exact: true })).toBeDisabled();
});
