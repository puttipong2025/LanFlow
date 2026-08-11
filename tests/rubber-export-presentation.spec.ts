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
    ["ต้นทุนซื้อเฉลี่ยรวมค่าทำงาน", "฿31.61/กก."],
    ["น้ำหนักปัจจุบัน", "295.00 กก."],
    ["น้ำหนักหาย", "2.64%"],
    ["ค่าทำงานต่อกิโลกรัม", "฿1.50"],
    ["ค่าดำเนินการอื่น", "฿120.00"],
    ["ยอดค่าทำงานรวม", "฿574.50"],
    ["อายุเฉลี่ยถ่วงน้ำหนัก", "2 วัน 1 ชั่วโมง (2.04 วัน) · ประมาณการ 1 บิล"],
    ["อายุมากที่สุด", "2 วัน 2 ชั่วโมง (2.08 วัน) · ประมาณการ 1 บิล"],
  ]);
  expect(rubberExportPdfFilename(details)).toBe(
    "LanFlow-rubber-export-REX-20260729-004-20260729-1504-A4-landscape.pdf",
  );
  expect(rubberExportShareTitle(details)).toContain(
    "รายการส่งออกยาง REX-20260729-004 · สาขาทดสอบ PDF · 29 ก.ค. 2569 15:04",
  );
});

test("uses em dashes for an unfinished draft", () => {
  const details = rubberExportDetails({
    status: "draft",
    currentWeight: null,
    weightLossPercent: null,
    workRate: null,
    workTotal: null,
    verifiedByName: null,
    verifiedAt: null,
    itemCount: 0,
    items: [],
    ageCalculatedAt: null,
    averageAgeHours: null,
    oldestAgeHours: null,
    estimatedAgeItemCount: null,
  });
  const presentation = buildRubberExportPresentation(details);

  expect(presentation.status).toBe("ฉบับร่าง");
  expect(presentation.summary[2]).toEqual(["ต้นทุนซื้อเฉลี่ยรวมค่าทำงาน", "—"]);
  expect(presentation.summary.slice(3, 6).map((entry) => entry[1])).toEqual(["—", "—", "—"]);
  expect(presentation.summary[7][1]).toBe("—");
  expect(presentation.summary.slice(8).map((entry) => entry[1])).toEqual(["—", "—"]);
  expect(presentation.audit.verified).toBe("—\n—");
});
