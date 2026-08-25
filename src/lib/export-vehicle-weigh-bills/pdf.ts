import type { WexDetails } from "@/types/export-vehicle-weigh-bills";
import {
  buildExportVehicleWeighBillPresentation,
  exportVehicleWeighBillPdfFilename,
} from "@/lib/export-vehicle-weigh-bills/presentation";

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderExportVehicleWeighBillHtml(details: WexDetails) {
  const presentation = buildExportVehicleWeighBillPresentation(details);
  const summary = presentation.summary.map(([label, value]) => (
    `<div class="summary"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join("");
  const vehicles = presentation.lines.map((line) => `
    <section class="block">
      <h2>${escapeHtml(line.vehicleRoleLabel)} · ${escapeHtml(line.vehicleRegistration)}</h2>
      <div class="row"><span>ผู้ขนส่ง</span><strong>${escapeHtml(line.carrierNameText)}</strong></div>
      <div class="row"><span>ขาเข้า</span><strong>${escapeHtml(line.inboundAtText)}</strong></div>
      <div class="row"><span>น้ำหนักขาเข้า</span><strong>${escapeHtml(line.inboundWeightText)} กก.</strong></div>
      <div class="row"><span>ขาออก</span><strong>${escapeHtml(line.outboundAtText)}</strong></div>
      <div class="row"><span>น้ำหนักขาออก</span><strong>${escapeHtml(line.outboundWeightText)} กก.</strong></div>
      <div class="row total"><span>น้ำหนักสุทธิ</span><strong>${escapeHtml(line.netWeightText)} กก.</strong></div>
    </section>`).join("");
  const rubberExports = presentation.rubberExports.length === 0
    ? "<p class=\"muted\">ไม่มีรายการ REX ที่จอง</p>"
    : `<table><thead><tr><th>รายการ REX</th><th>น้ำหนัก</th></tr></thead><tbody>${presentation.rubberExports.map((item) => (
      `<tr><td>${escapeHtml(item.exportNo)}</td><td>${escapeHtml(item.currentWeightText)} กก.</td></tr>`
    )).join("")}</tbody></table>`;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8" /><style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { width: 72mm; margin: 0; color: #172b26; font-family: "Noto Sans Thai", Tahoma, sans-serif; font-size: 11px; line-height: 1.45; }
    h1 { margin: 0; font-size: 17px; line-height: 1.2; } h2 { margin: 0 0 5px; font-size: 13px; }
    .meta, .muted { color: #52635d; } .section { margin-top: 13px; } .block { margin-top: 8px; border-top: 1px dashed #a7b8b0; padding-top: 8px; }
    .summary, .row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; } .summary strong, .row strong, td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .total { border-top: 1px solid #789187; margin-top: 4px; padding-top: 5px; } table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #d4ded9; padding: 5px 0; text-align: left; } th:last-child { text-align: right; }
    footer { margin-top: 14px; border-top: 1px dashed #a7b8b0; padding-top: 7px; color: #52635d; font-size: 10px; }
  </style></head><body>
    <h1>บิลรถส่งออก</h1>
    <p class="meta">${escapeHtml(details.wexNo)} · ${escapeHtml(details.locationName)}<br />สร้างโดย ${escapeHtml(details.createdByName || "—")} · ${escapeHtml(presentation.createdAtText)}</p>
    <section class="section">${summary}</section>
    <section class="section"><h2>รายการชั่งรถ</h2>${vehicles}</section>
    <section class="section"><h2>รายการ REX ที่จอง</h2>${rubberExports}</section>
    <footer>เอกสารอ้างอิงการชั่งและบรรทุกยาง · แก้ไขล่าสุด ${escapeHtml(presentation.updatedAtText)}</footer>
  </body></html>`;
}

export function exportVehicleWeighBillPdfDocument(details: WexDetails) {
  return {
    html: renderExportVehicleWeighBillHtml(details),
    filename: exportVehicleWeighBillPdfFilename(details),
  };
}
