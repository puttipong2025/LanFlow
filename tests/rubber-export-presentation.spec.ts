import { expect, test } from "@playwright/test";
import {
  buildRubberExportPresentation,
  rubberExportPdfFilename,
  rubberExportShareTitle,
  rubberExportStatusLabel,
} from "@/lib/rubber-exports/rubber-export-presentation";
import { rubberExportDetails } from "./rubber-export-pdf.fixture";

test("formats a verified Rubber Export for an A4 PDF in Bangkok time", () => {
  const details = rubberExportDetails();
  const presentation = buildRubberExportPresentation(details);

  expect(rubberExportStatusLabel(details)).toBe("ตรวจสอบแล้ว");
  expect(presentation.summary).toEqual([
    ["น้ำหนักสุทธิรวม", "303.00 กก."],
    ["ยอดจ่ายจริงรวม", "฿9,003.00"],
    ["ต้นทุนซื้อเฉลี่ย", "฿29.71/กก."],
    ["น้ำหนักปัจจุบัน", "295.00 กก."],
    ["น้ำหนักหาย", "2.64%"],
    ["ค่าทำงานต่อกิโลกรัม", "฿1.50"],
    ["ค่าดำเนินการอื่น", "฿120.00"],
    ["ยอดค่าทำงานรวม", "฿562.50"],
  ]);
  expect(rubberExportPdfFilename(details)).toBe(
    "LanFlow-rubber-export-REX-20260729-004-20260729-1504-A4-landscape.pdf",
  );
  expect(rubberExportShareTitle(details)).toContain(
    "รายการส่งออกยาง REX-20260729-004 · สาขาทดสอบ PDF · 29 ก.ค. 2569 15:04",
  );
});

test("keeps deletion evidence and uses em dashes for a deleted draft", () => {
  const details = rubberExportDetails({
    status: "deleted",
    previousStatus: "draft",
    currentWeight: null,
    weightLossPercent: null,
    workRate: null,
    workTotal: null,
    verifiedByName: null,
    verifiedAt: null,
    deletedByName: "ผู้ลบ",
    deletedAt: "2026-07-29T09:00:00.000Z",
    itemCount: 0,
    items: [],
  });
  const presentation = buildRubberExportPresentation(details);

  expect(presentation.status).toBe("ลบแล้ว (สำเนา)");
  expect(presentation.previousStatus).toBe("ฉบับร่าง");
  expect(presentation.summary.slice(3, 6).map((entry) => entry[1])).toEqual(["—", "—", "—"]);
  expect(presentation.summary[7][1]).toBe("—");
  expect(presentation.audit.verified).toBe("—\n—");
  expect(presentation.audit.deleted).toContain("ผู้ลบ");
});
