import { expect, test } from "@playwright/test";

import {
  buildEvidenceSlides,
  evidenceImageKey,
  paginateEvidenceItems,
  selectEvidenceCards,
  type EvidenceDetail,
} from "../src/lib/rubber-evidence/slides";
import type { EvidenceReviewState } from "../src/hooks/useRubberBillEvidenceReview";
import type { RubberBill } from "../src/types";

test("paginates at five cards and clamps after a filtered replacement", () => {
  expect(paginateEvidenceItems([1, 2, 3, 4, 5, 6], 1).items).toEqual([1, 2, 3, 4, 5]);
  expect(paginateEvidenceItems([1, 2, 3, 4, 5, 6], 2).items).toEqual([6]);
  expect(paginateEvidenceItems([1, 2, 3, 4], 2)).toEqual({
    currentPage: 1,
    totalPages: 1,
    items: [1, 2, 3, 4],
  });
});

test("orders weigh rows deterministically and shows the latest mapped rubber only in summary", () => {
  const detail: EvidenceDetail = {
    bill: {
      id: "bill-1",
      revisionNo: 3,
      billNo: "RB-1",
      customerName: "ลูกค้า",
      clientCreatedAt: "2026-08-18T00:00:00Z",
      manualCorrectionCount: 0,
    },
    rows: [
      { id: "row-2", sequenceNo: 2, label: "สอง", inWeight: 20, outWeight: 2, netWeight: 18, rubberImageUrl: "/rubber-2", displayInImageUrl: "/in-2", displayOutImageUrl: null },
      { id: "row-1", sequenceNo: 1, label: "หนึ่ง", inWeight: 10, outWeight: 1, netWeight: 9, rubberImageUrl: "/rubber-1", displayInImageUrl: "/in-1", displayOutImageUrl: null },
    ],
  };

  const slides = buildEvidenceSlides(detail);
  expect(slides.map((slide) => slide.kind === "weigh" ? slide.row.sequenceNo : "summary")).toEqual([1, 2, "summary"]);
  expect(slides.slice(0, -1).every((slide) => slide.kind === "weigh")).toBe(true);
  expect(slides.at(-1)).toMatchObject({ kind: "summary", rubberRow: { id: "row-2" } });
  expect(evidenceImageKey("bill-1", 3, "row-2", "rubber")).toBe("bill-1:3:row-2:rubber");
});

test("selects only synced in-period cards and applies the queue order", () => {
  const bills = [
    { id: "old", recordStatus: "active", syncStatus: "synced", clientCreatedAt: "2026-08-18T01:00:00Z", customerName: "เก่า" },
    { id: "new", recordStatus: "active", syncStatus: "synced", clientCreatedAt: "2026-08-18T02:00:00Z", customerName: "ใหม่" },
    { id: "offline", recordStatus: "active", syncStatus: "pending", clientCreatedAt: "2026-08-18T03:00:00Z", customerName: "ออฟไลน์" },
  ] as unknown as RubberBill[];
  const state = (billId: string, reviewStatus: EvidenceReviewState["reviewStatus"]): EvidenceReviewState => ({
    locationId: "branch",
    billId,
    revisionNo: 1,
    clientCreatedAt: bills.find((bill) => bill.id === billId)?.clientCreatedAt ?? null,
    reviewPeriodId: reviewStatus === "outside" ? null : "period",
    reviewStatus,
    missingRubber: false,
    missingDisplayIn: false,
    hasManualCorrection: false,
    isUnpriced: false,
    hasAnyEvidence: true,
    requiredRoleCount: 2,
    presentRequiredRoleCount: 2,
    decision: null,
    reviewedByName: null,
    reviewedAt: null,
  });
  const states = [state("new", "pending"), state("old", "pending"), state("offline", "pending")];

  expect(selectEvidenceCards(bills, states, "pending", "").map(({ bill }) => bill.id)).toEqual(["old", "new"]);
  expect(selectEvidenceCards(bills, states, "all", "ใหม่").map(({ bill }) => bill.id)).toEqual(["new"]);
});
