import { expect, test } from "@playwright/test";

import {
  buildEvidenceSlides,
  evidenceImageKey,
  type EvidenceDetail,
} from "../src/lib/rubber-evidence/slides";

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
