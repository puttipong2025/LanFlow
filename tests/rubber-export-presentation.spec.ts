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
    ["มูลค่ายางรวม", "฿8,703.00"],
    ["ราคาจากบิล/กก.", "฿28.72"],
    ["ต้นทุนรวมค่าดำเนินการ", "฿9,277.50"],
    ["ราคาปัจจุบัน/กก.", "฿31.45"],
    ["น้ำหนักปัจจุบัน", "295.00 กก."],
    ["น้ำหนักลดลง (%)", "2.64%"],
    ["ค่าทำงานต่อกิโลกรัม", "฿1.50"],
    ["ค่าดำเนินการอื่น", "฿120.00"],
    ["ค่าทำงานและค่าดำเนินการรวม", "฿574.50"],
    ["อายุเฉลี่ยถ่วงน้ำหนัก", "2 วัน 1 ชั่วโมง (2.04 วัน) · ประมาณการ 1 บิล"],
    ["อายุมากที่สุด", "2 วัน 2 ชั่วโมง (2.08 วัน) · ประมาณการ 1 บิล"],
  ]);
  expect(presentation.formulas).toEqual([
    "ราคาจากบิล/กก. = มูลค่ายางรวม ÷ น้ำหนักสุทธิรวม",
    "ราคาปัจจุบัน/กก. = (มูลค่ายางรวม + ค่าทำงานและค่าดำเนินการรวม) ÷ น้ำหนักปัจจุบัน",
  ]);
  expect(presentation.items[0].rubberValueAmountText).toBe("2,900.00");
  expect(presentation.items[0].rubberValueAmountText).not.toBe("3,000.00");
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
  expect(presentation.summary).toHaveLength(12);
  expect(presentation.summary[1]).toEqual(["มูลค่ายางรวม", "฿8,703.00"]);
  expect(presentation.summary[2]).toEqual(["ราคาจากบิล/กก.", "฿28.72"]);
  expect(presentation.summary[3]).toEqual(["ต้นทุนรวมค่าดำเนินการ", "—"]);
  expect(presentation.summary[4]).toEqual(["ราคาปัจจุบัน/กก.", "—"]);
  expect(presentation.summary.slice(5, 8).map((entry) => entry[1])).toEqual(["—", "—", "—"]);
  expect(presentation.summary[9][1]).toBe("—");
  expect(presentation.summary.slice(10).map((entry) => entry[1])).toEqual(["—", "—"]);
  expect(presentation.audit.verified).toBe("—\n—");
});

test("keeps purchase cost total when current weight is missing", () => {
  const presentation = buildRubberExportPresentation(rubberExportDetails({
    currentWeight: null,
  }));

  expect(presentation.summary[3]).toEqual(["ต้นทุนรวมค่าดำเนินการ", "฿9,277.50"]);
  expect(presentation.summary[4]).toEqual(["ราคาปัจจุบัน/กก.", "—"]);
});

test("recalculates draft price from changed weight and work cost", () => {
  const byWeight = buildRubberExportPresentation(rubberExportDetails({
    status: "draft",
    currentWeight: 290,
  }));
  const byWork = buildRubberExportPresentation(rubberExportDetails({
    status: "draft",
    workTotal: 500,
  }));

  expect(byWeight.summary[4]).toEqual(["ราคาปัจจุบัน/กก.", "฿31.99"]);
  expect(byWork.summary[3]).toEqual(["ต้นทุนรวมค่าดำเนินการ", "฿9,203.00"]);
  expect(byWork.summary[4]).toEqual(["ราคาปัจจุบัน/กก.", "฿31.20"]);
});
