"use client";

import { Loader2, Pencil, Share2, Trash2 } from "lucide-react";

import { ModalShell } from "@/components/shared/ModalShell";
import {
  buildExportVehicleWeighBillPresentation,
  formatExportVehicleWeighBillNumber,
} from "@/lib/export-vehicle-weigh-bills/presentation";
import type { WexDetails } from "@/types/export-vehicle-weigh-bills";

export function ExportVehicleWeighBillDetailModal({
  details,
  online,
  canEdit,
  canDelete,
  sharing,
  onEdit,
  onDelete,
  onShare,
  onClose,
}: {
  details: WexDetails;
  online: boolean;
  canEdit: boolean;
  canDelete: boolean;
  sharing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const presentation = buildExportVehicleWeighBillPresentation(details);

  return (
    <ModalShell
      title={details.wexNo}
      subtitle={`${details.locationName} · บิลรถส่งออก`}
      onClose={onClose}
      closeOnEscape
      nativeModal
      renderInPortal
      size="wide"
      mobileFullScreen
    >
      <div className="space-y-5">
        {!online && <p role="status" className="rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">กำลังแสดงข้อมูลล่าสุดที่โหลดไว้; WEX แชร์ แก้ไข และลบได้เมื่อออนไลน์เท่านั้น</p>}
        <section aria-label="สรุปน้ำหนัก" className="grid gap-3 sm:grid-cols-3">
          {presentation.summary.map(([label, value]) => <div key={label} className="rounded-lg bg-field p-3"><p className="text-xs text-ink/60">{label}</p><p className="font-bold tabular-nums text-ink">{value}</p></div>)}
        </section>
        <section aria-labelledby="wex-detail-vehicles"><h3 id="wex-detail-vehicles" className="mb-2 font-bold text-ink">รายการชั่งรถ</h3><div className="overflow-x-auto rounded-md border border-black/10"><table className="min-w-[900px] w-full text-sm"><thead className="bg-mint/50"><tr><th scope="col" className="px-3 py-2 text-left">รถ</th><th scope="col" className="px-3 py-2 text-left">ผู้ขนส่ง</th><th scope="col" className="px-3 py-2 text-left">เวลาเข้า</th><th scope="col" className="px-3 py-2 text-right">ขาเข้า</th><th scope="col" className="px-3 py-2 text-left">เวลาออก</th><th scope="col" className="px-3 py-2 text-right">ขาออก</th><th scope="col" className="px-3 py-2 text-right">สุทธิ</th></tr></thead><tbody className="divide-y divide-black/5">{presentation.lines.map((line) => <tr key={line.id}><td className="px-3 py-2"><span className="block text-xs font-semibold text-ink/60">{line.vehicleRoleLabel}</span><span className="block font-semibold">{line.vehicleRegistration}</span></td><td className="px-3 py-2">{line.carrierNameText}</td><td className="px-3 py-2">{line.inboundAtText}</td><td className="px-3 py-2 text-right tabular-nums">{line.inboundWeightText}</td><td className="px-3 py-2">{line.outboundAtText}</td><td className="px-3 py-2 text-right tabular-nums">{line.outboundWeightText}</td><td className="px-3 py-2 text-right font-bold tabular-nums">{line.netWeightText}</td></tr>)}</tbody></table></div></section>
        <section aria-labelledby="wex-detail-rex"><h3 id="wex-detail-rex" className="mb-2 font-bold text-ink">REX ที่จอง</h3>{presentation.rubberExports.length === 0 ? <p className="rounded-md bg-field px-4 py-3 text-sm text-ink/60">ไม่มีรายการ REX ที่จอง</p> : <div className="overflow-hidden rounded-md border border-black/10"><table className="w-full text-sm"><thead className="bg-mint/50"><tr><th scope="col" className="px-3 py-2 text-left">เลขที่ REX</th><th scope="col" className="px-3 py-2 text-right">น้ำหนักปัจจุบัน</th></tr></thead><tbody className="divide-y divide-black/5">{presentation.rubberExports.map((item) => <tr key={item.rubberExportId}><td className="px-3 py-2 font-semibold">{item.exportNo}</td><td className="px-3 py-2 text-right tabular-nums">{item.currentWeightText} กก.</td></tr>)}</tbody></table></div>}</section>
        <section className="rounded-md border border-black/10 bg-sand p-4" aria-labelledby="wex-detail-audit"><h3 id="wex-detail-audit" className="font-bold text-ink">ข้อมูลเอกสาร</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-ink/60">ผู้สร้าง</dt><dd className="font-semibold">{details.createdByName || "—"} · {presentation.createdAtText}</dd></div><div><dt className="text-ink/60">แก้ไขล่าสุด</dt><dd className="font-semibold">{presentation.updatedAtText}</dd></div><div><dt className="text-ink/60">ฉบับแก้ไข</dt><dd className="font-semibold tabular-nums">{formatExportVehicleWeighBillNumber(details.revision)}</dd></div></dl></section>
        <div className="modal-actions flex flex-wrap justify-end gap-2"><button type="button" disabled={!online || sharing} title={!online ? "แชร์ PDF ได้เมื่อออนไลน์เท่านั้น" : "แชร์ PDF บิลรถส่งออก"} onClick={onShare} className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-river px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{sharing ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}แชร์ PDF</button>{canEdit && <button type="button" disabled={!online || sharing} onClick={onEdit} className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white disabled:opacity-50"><Pencil size={16} aria-hidden="true" />แก้ไข</button>}{canDelete && <button type="button" disabled={!online || sharing} onClick={onDelete} className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-clay px-4 font-semibold text-white disabled:opacity-50"><Trash2 size={16} aria-hidden="true" />ลบ WEX</button>}</div>
      </div>
    </ModalShell>
  );
}
