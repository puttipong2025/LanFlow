"use client";

import { FilePlus2, Loader2, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { ExportVehicleWeighBillDetailModal } from "@/components/rubber-bills/ExportVehicleWeighBillDetailModal";
import { ExportVehicleWeighBillFormModal } from "@/components/rubber-bills/ExportVehicleWeighBillFormModal";
import { useExportVehicleWeighBills, type ExportVehicleWeighBillPayload } from "@/hooks/useExportVehicleWeighBills";
import { useSharePdf } from "@/hooks/useSharePdf";
import { exportVehicleWeighBillPdfDocument } from "@/lib/export-vehicle-weigh-bills/pdf";
import { formatExportVehicleWeighBillNumber } from "@/lib/export-vehicle-weigh-bills/presentation";
import type { Location } from "@/types";
import type { WexDetails, WexSummary } from "@/types/export-vehicle-weigh-bills";

type DetailTarget = Pick<WexSummary, "id" | "wexNo">;

export function ExportVehicleWeighBillsModal({
  selectedLocation,
  online,
}: {
  selectedLocation: Location;
  online: boolean;
}) {
  const api = useExportVehicleWeighBills({ locationId: selectedLocation.id, online });
  const pdfShare = useSharePdf();
  const detailControllerRef = useRef<AbortController | null>(null);
  const optionsControllerRef = useRef<AbortController | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [details, setDetails] = useState<WexDetails | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [formDetails, setFormDetails] = useState<WexDetails | null | undefined>(undefined);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof api.options>>>({
    rubberExports: [],
    carriers: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WexDetails | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);

  useEffect(() => {
    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
    optionsControllerRef.current?.abort();
    optionsControllerRef.current = null;
    setDetailTarget(null);
    setDetails(null);
    setDetailError(null);
    setFormDetails(undefined);
    setOptions({ rubberExports: [], carriers: [] });
    setOptionsError(null);
    setOptionsLoading(false);
  }, [online, selectedLocation.id]);

  useEffect(() => () => {
    detailControllerRef.current?.abort();
    optionsControllerRef.current?.abort();
  }, []);

  async function openDetails(target: DetailTarget) {
    if (!online) return;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    setDetailTarget(target);
    setDetails(null);
    setDetailError(null);
    try {
      const loaded = await api.details(target.id, controller.signal);
      if (detailControllerRef.current === controller) setDetails(loaded);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (detailControllerRef.current === controller) setDetailError(caught instanceof Error ? caught.message : "โหลดรายละเอียด WEX ไม่สำเร็จ");
    } finally {
      if (detailControllerRef.current === controller) detailControllerRef.current = null;
    }
  }

  function closeDetails() {
    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
    setDetailTarget(null);
    setDetails(null);
    setDetailError(null);
  }

  async function openForm(nextDetails: WexDetails | null) {
    if (!online) return;
    optionsControllerRef.current?.abort();
    const controller = new AbortController();
    optionsControllerRef.current = controller;
    setFormDetails(nextDetails);
    setOptions({ rubberExports: [], carriers: [] });
    setOptionsError(null);
    setOptionsLoading(true);
    try {
      const nextOptions = await api.options(nextDetails?.id, controller.signal);
      if (optionsControllerRef.current === controller) setOptions(nextOptions);
    } catch (caught) {
      if (!(caught instanceof Error && caught.name === "AbortError") && optionsControllerRef.current === controller) {
        setOptionsError(caught instanceof Error ? caught.message : "โหลดรายการ REX ที่เลือกได้ไม่สำเร็จ");
      }
    } finally {
      if (optionsControllerRef.current === controller) {
        optionsControllerRef.current = null;
        setOptionsLoading(false);
      }
    }
  }

  async function submitForm(payload: ExportVehicleWeighBillPayload) {
    if (formDetails) {
      const updated = await api.update(formDetails.id, formDetails.revision, payload);
      toast.success(`บันทึก ${updated.wexNo} แล้ว`);
      setFormDetails(undefined);
      await openDetails({ id: updated.id, wexNo: updated.wexNo });
      return;
    }
    const created = await api.create(payload);
    toast.success(`สร้าง ${created.wexNo} แล้ว`);
    setFormDetails(undefined);
    await openDetails({ id: created.id, wexNo: created.wexNo });
  }

  async function share(target: DetailTarget) {
    if (!online || pdfShare.busy) return;
    setSharingId(target.id);
    try {
      const delivery = await pdfShare.sharePdf(async (signal) => {
        const freshDetails = await api.details(target.id, signal);
        return exportVehicleWeighBillPdfDocument(freshDetails);
      });
      if (delivery === "shared") toast.success(`แชร์ ${target.wexNo} แล้ว`);
      else if (delivery === "downloaded") toast.info("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "สร้าง PDF บิลรถส่งออกไม่สำเร็จ");
    } finally {
      setSharingId(null);
    }
  }

  async function deleteWex() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const deleted = await api.remove(pendingDelete.id, pendingDelete.revision);
      toast.success(`ลบ ${deleted.wexNo} แล้ว`);
      if (details?.id === pendingDelete.id) closeDetails();
      setPendingDelete(null);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "ลบบิลรถส่งออกไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="บิลรถส่งออก">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div><h2 className="text-balance text-lg font-bold text-ink">บิลรถส่งออก (WEX) · {selectedLocation.name}</h2><p className="text-pretty text-sm text-ink/60">หลักฐานชั่งและบรรทุกยางของรถ 1–2 คัน โดยไม่สร้างรายการการเงินหรือรายงาน</p></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto"><button type="button" disabled={!online || api.loading} onClick={() => void api.reload()} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={16} className={api.loading ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden="true" />รีเฟรช</button>{api.permissions.canCreate && <button type="button" disabled={!online || optionsLoading} title={!online ? "สร้าง WEX ได้เมื่อออนไลน์เท่านั้น" : "สร้างบิลรถส่งออก"} onClick={() => void openForm(null)} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><FilePlus2 size={16} aria-hidden="true" />สร้างบิลรถส่งออก</button>}</div>
      </div>
      {!online && <p role="status" className="rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">บิลรถส่งออกเป็นเอกสารออนไลน์เท่านั้น โปรดเชื่อมต่ออินเทอร์เน็ตเพื่อดูหรือจัดการ</p>}
      {online && api.error && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{api.error}</p>}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm" aria-busy={api.loading}>
        {api.loading ? <div role="status" className="flex min-h-44 items-center justify-center gap-2 p-6 text-sm font-semibold text-ink/60"><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />กำลังโหลดบิลรถส่งออก...</div> : api.bills.length === 0 ? <div className="p-10 text-center"><p className="font-bold text-ink">ยังไม่มีบิลรถส่งออก</p><p className="mt-1 text-sm text-ink/60">สร้าง WEX เมื่อนำรายการ REX ที่ขายออกแล้วขึ้นรถ</p></div> : <div className="overflow-x-auto"><table className="min-w-[880px] w-full text-sm"><thead className="bg-mint/50"><tr><th scope="col" className="px-3 py-3 text-left">เลขที่ WEX</th><th scope="col" className="px-3 py-3 text-left">สร้างเมื่อ</th><th scope="col" className="px-3 py-3 text-right">รถ</th><th scope="col" className="px-3 py-3 text-right">REX</th><th scope="col" className="px-3 py-3 text-right">สุทธิรถ</th><th scope="col" className="px-3 py-3 text-right">คงเหลือ</th><th scope="col" className="px-3 py-3 text-right">การทำงาน</th></tr></thead><tbody className="divide-y divide-black/5">{api.bills.map((bill) => <tr key={bill.id}><td className="px-3 py-3 font-semibold">{bill.wexNo}</td><td className="px-3 py-3">{new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(bill.createdAt))}</td><td className="px-3 py-3 text-right tabular-nums">{bill.vehicleCount}</td><td className="px-3 py-3 text-right tabular-nums">{bill.rubberExportCount}</td><td className="px-3 py-3 text-right tabular-nums">{formatExportVehicleWeighBillNumber(bill.vehicleNetWeight)}</td><td className="px-3 py-3 text-right tabular-nums">{formatExportVehicleWeighBillNumber(bill.remainingWeight)}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => void openDetails(bill)} className="focus-ring rounded-md bg-actionSecondary px-3 py-2 text-xs font-semibold text-white">รายละเอียด</button><button type="button" aria-label={`แชร์ PDF ${bill.wexNo}`} disabled={!online || pdfShare.busy} onClick={() => void share(bill)} className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md bg-river text-white disabled:opacity-50"><Share2 size={15} aria-hidden="true" /></button></div></td></tr>)}</tbody></table></div>}
      </div>
      {api.hasMore && !api.loading && <div className="text-center"><button type="button" disabled={api.loadingMore} onClick={() => void api.loadMore()} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{api.loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}</button></div>}

      {detailTarget && !details && <ModalShell title={detailTarget.wexNo} subtitle={detailError ? "โหลดรายละเอียด WEX ไม่สำเร็จ" : "กำลังโหลดรายละเอียด WEX"} onClose={closeDetails} closeOnEscape nativeModal renderInPortal size="compact"><div className="min-h-28 py-4">{detailError ? <p role="alert" className="text-sm font-semibold text-red-700">{detailError}</p> : <p role="status" className="inline-flex items-center gap-2 text-sm text-ink/60"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />กำลังโหลดรายละเอียด WEX...</p>}</div></ModalShell>}
      {details && <ExportVehicleWeighBillDetailModal details={details} online={online} canEdit={api.permissions.canEdit} canDelete={api.permissions.canDelete} sharing={sharingId === details.id} onEdit={() => void openForm(details)} onDelete={() => setPendingDelete(details)} onShare={() => void share(details)} onClose={closeDetails} />}
      {formDetails !== undefined && <ExportVehicleWeighBillFormModal locationName={selectedLocation.name} details={formDetails} online={online} rubberOptions={options.rubberExports} carriers={options.carriers} optionsLoading={optionsLoading} optionsError={optionsError} onSubmit={submitForm} onClose={() => setFormDetails(undefined)} />}
      <AlertDialog open={Boolean(pendingDelete)} title="ลบบิลรถส่งออก" description={`ต้องการลบ ${pendingDelete?.wexNo ?? ""} ใช่หรือไม่? การลบจะปลดการจอง REX แต่ไม่ยกเลิกสถานะขายออก`} confirmLabel="ลบ WEX" busy={deleting} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteWex()} />
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </section>
  );
}
