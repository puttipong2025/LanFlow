import { expect, test } from "@playwright/test";

import {
  buildExportVehicleWeighBillPresentation,
  exportVehicleWeighBillPdfFilename,
  exportVehicleWeighBillShareTitle,
} from "@/lib/export-vehicle-weigh-bills/presentation";
import { renderExportVehicleWeighBillHtml } from "@/lib/export-vehicle-weigh-bills/pdf";

const details = {
  id: "wex-test-1",
  wexNo: "WEX-20260824-001",
  locationId: "location-test-1",
  locationName: "สาขาทดสอบ WEX",
  revision: 3,
  vehicleCount: 2,
  rubberExportCount: 2,
  vehicleNetWeight: 820,
  reservedRubberWeight: 700,
  remainingWeight: 120,
  createdByName: "ผู้จัดการทดสอบ",
  createdAt: "2026-08-24T08:15:00.000Z",
  updatedAt: "2026-08-24T08:20:00.000Z",
  lines: [
    {
      id: "line-1",
      sequenceNo: 1,
      vehicleRegistration: "กข 1234",
      carrierId: "carrier-1",
      carrierName: "บริษัทขนส่งทดสอบ",
      inboundAt: "2026-08-24T08:00:00.000Z",
      inboundWeight: 1200,
      outboundAt: "2026-08-24T09:00:00.000Z",
      outboundWeight: 1600,
      netWeight: 400,
    },
    {
      id: "line-2",
      sequenceNo: 2,
      vehicleRegistration: "กข 5678",
      carrierId: null,
      carrierName: null,
      inboundAt: "2026-08-24T08:10:00.000Z",
      inboundWeight: 900,
      outboundAt: "2026-08-24T09:20:00.000Z",
      outboundWeight: 1320,
      netWeight: 420,
    },
  ],
  rubberExports: [
    { rubberExportId: "rex-1", exportNo: "REX-20260823-001", currentWeight: 350 },
    { rubberExportId: "rex-2", exportNo: "REX-20260823-002", currentWeight: 350 },
  ],
};

test("builds a Bangkok 80mm WEX receipt with both vehicles and reserved REX weights", () => {
  const presentation = buildExportVehicleWeighBillPresentation(details);

  expect(presentation.summary).toEqual([
    ["น้ำหนักสุทธิรถรวม", "820.00 กก."],
    ["น้ำหนัก REX ที่จอง", "700.00 กก."],
    ["น้ำหนักคงเหลือบนรถ", "120.00 กก."],
  ]);
  expect(presentation.lines.map((line) => line.vehicleRegistration)).toEqual(["กข 1234", "กข 5678"]);
  expect(presentation.lines.map((line) => line.carrierNameText)).toEqual(["บริษัทขนส่งทดสอบ", "—"]);
  expect(exportVehicleWeighBillPdfFilename(details)).toBe("LanFlow-export-vehicle-weigh-bill-WEX-20260824-001-80mm.pdf");
  expect(exportVehicleWeighBillShareTitle(details)).toContain("WEX-20260824-001 · สาขาทดสอบ WEX");

  const html = renderExportVehicleWeighBillHtml(details);
  expect(html).toContain("@page { size: 80mm auto;");
  expect(html).toContain("กข 1234");
  expect(html).toContain("กข 5678");
  expect(html).toContain("บริษัทขนส่งทดสอบ");
  expect(html).toContain("ผู้ขนส่ง</span><strong>—");
  expect(html).toContain("REX-20260823-001");
  expect(html).toContain("น้ำหนักคงเหลือบนรถ");
});

test("keeps a manual carrier snapshot separate from a selected carrier ID", () => {
  const presentation = buildExportVehicleWeighBillPresentation({
    ...details,
    lines: [{
      ...details.lines[0],
      carrierId: null,
      carrierName: "นายสมชาย ขนส่งเอง",
    }],
  });

  expect(presentation.lines[0]).toMatchObject({
    carrierId: null,
    carrierNameText: "นายสมชาย ขนส่งเอง",
  });
});
