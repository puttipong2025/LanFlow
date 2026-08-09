"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types";
import type { RubberExportDetails, RubberExportStatus, RubberExportSummary } from "@/types/rubber-exports";
import { cn } from "@/lib/cn";
import { useRubberExports } from "@/hooks/useRubberExports";
import { useSharePdf } from "@/hooks/useSharePdf";
import { createRubberExportPdfFile } from "@/lib/rubber-exports/rubber-export-pdf";
import { rubberExportShareTitle } from "@/lib/rubber-exports/rubber-export-presentation";
import { RubberExportCreateModal } from "@/components/rubber-exports/RubberExportCreateModal";
import { RubberExportDetailModal } from "@/components/rubber-exports/RubberExportDetailModal";
import { RubberExportTable } from "@/components/rubber-exports/RubberExportTable";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { ModalShell } from "@/components/shared/ModalShell";

type Filter = "active" | RubberExportStatus | "all";

export function RubberExportsModule({
  selectedLocation,
  online,
  initialExportId,
  onInitialExportHandled,
  onOpenReports,
}: {
  selectedLocation: Location;
  online: boolean;
  initialExportId?: string | null;
  onInitialExportHandled?: () => void;
  onOpenReports: () => void;
}) {
  const api = useRubberExports(selectedLocation.id, online);
  const [filter, setFilter] = useState<Filter>("active");
  const [creating, setCreating] = useState(false);
  const [details, setDetails] = useState<RubberExportDetails | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RubberExportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pdfShare = useSharePdf();
  const counts = useMemo(() => ({
    active: api.exports.filter((row) => row.status !== "deleted").length,
    draft: api.exports.filter((row) => row.status === "draft").length,
    verified: api.exports.filter((row) => row.status === "verified").length,
    deleted: api.exports.filter((row) => row.status === "deleted").length,
    all: api.exports.length,
  }), [api.exports]);
  const visibleRows = useMemo(() => api.exports
    .filter((row) => {
      if (filter === "all") return true;
      if (filter === "active") return row.status !== "deleted";
      return row.status === filter;
    })
    .sort((left, right) => {
      const rank = { draft: 0, verified: 1, deleted: 2 };
      const statusDifference = rank[left.status] - rank[right.status];
      if (statusDifference !== 0) return statusDifference;
      const timeDifference = left.createdAt.localeCompare(right.createdAt);
      if (timeDifference !== 0) return left.status === "draft" ? timeDifference : -timeDifference;
      return left.id.localeCompare(right.id);
    }), [api.exports, filter]);

  async function open(exportId: string) {
    try {
      setDetails(await api.details(exportId));
      onInitialExportHandled?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายการส่งออกไม่สำเร็จ");
    }
  }

  useEffect(() => {
    if (initialExportId && online) void open(initialExportId);
    // Opening is intentionally keyed only by the source ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExportId, online]);

  async function remove(row: RubberExportSummary) {
    if (row.reportLockNo) return;
    setDeleting(true);
    try {
      await api.remove(row.id);
      toast.success(`ลบ ${row.exportNo} แล้ว`);
      if (details?.id === row.id) setDetails(null);
      setPendingDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบรายการส่งออกไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  async function share(row: Pick<RubberExportSummary, "id" | "exportNo">) {
    if (!online || pdfShare.busy) return;
    setSharingId(row.id);
    try {
      const delivery = await pdfShare.sharePdfFile(async (signal) => {
        const freshDetails = await api.details(row.id, signal);
        if (freshDetails.status === "draft") {
          throw new Error("แชร์ PDF ได้เฉพาะรายการตรวจสอบแล้วหรือลบแล้ว");
        }
        return {
          file: await createRubberExportPdfFile(freshDetails, signal),
          title: rubberExportShareTitle(freshDetails),
        };
      });
      if (delivery === "shared") {
        toast.success(`แชร์ ${row.exportNo} แล้ว`);
      } else if (delivery === "downloaded") {
        toast.info("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF รายการส่งออกยางไม่สำเร็จ");
    } finally {
      setSharingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:p-4">
        <div>
          <h2 className="text-balance text-xl font-bold text-ink">ส่งออกยาง — {selectedLocation.name}</h2>
          <p className="mt-1 text-pretty text-sm text-ink/65">เลือกบิลที่ล็อกในรายงาน และจองบิลที่เลือกทันทีเมื่อสร้างฉบับร่าง</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button type="button" onClick={() => void api.reload()} disabled={!online || api.loading} className="focus-ring inline-flex items-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50">
            <RotateCw size={16} className={api.loading ? "animate-spin" : ""} /> รีเฟรช
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!online || api.availableBills.length === 0}
            title={!online ? "ต้องออนไลน์ก่อนสร้างรายการ" : api.availableBills.length === 0 ? "ต้องสร้างรายงานที่ล็อกบิลยางก่อน" : "สร้างรายการส่งออกยาง"}
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <FilePlus2 size={16} /> สร้างรายการ
          </button>
        </div>
      </div>

      {!online && <div className="rounded-lg bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">ส่งออกยางใช้ได้เมื่อออนไลน์เท่านั้น</div>}
      {online && api.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {api.error}
        </div>
      )}
      {online && !api.loading && !api.error && api.availableBills.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-lg bg-field px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ink">ยังไม่มีบิลที่พร้อมส่งออก</p>
            <p className="mt-1 text-pretty text-sm text-ink/65">สร้างรายงานเพื่อยืนยันและล็อกบิลยางก่อน แล้วจึงกลับมาเลือกรายการส่งออก</p>
          </div>
          <button type="button" onClick={onOpenReports} className="focus-ring shrink-0 rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">
            ไปหน้ารายงาน
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          ["active", "ใช้งาน"],
          ["draft", "ฉบับร่าง"],
          ["verified", "ตรวจสอบแล้ว"],
          ["deleted", "ลบแล้ว"],
          ["all", "ทั้งหมด"],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-label={`${label} ${counts[value]} รายการ`}
            title={`${label} ${counts[value]} รายการ`}
            className={cn(
              "focus-ring inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white",
              filter === value ? "bg-leaf" : "bg-actionSecondary hover:bg-actionSecondary/90",
            )}
          >
            {label}
            <span aria-hidden="true" className="min-w-5 rounded-full bg-amber px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white tabular-nums">
              {counts[value] > 99 ? "99+" : counts[value]}
            </span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <RubberExportTable
          rows={visibleRows}
          loading={api.loading}
          canDelete={api.permissions.canDelete}
          canVerify={api.permissions.canVerify}
          shareBusy={pdfShare.busy}
          sharingId={sharingId}
          onOpen={(id) => void open(id)}
          onShare={(row) => void share(row)}
          onDelete={setPendingDelete}
        />
      </div>

      {creating && (
        <RubberExportCreateModal
          key={api.availableBills.map((bill) => bill.reportItemId).join(",")}
          availableBills={api.availableBills}
          onPreview={api.preview}
          onCreate={async (selectedReportItemIds) => {
            try {
              const created = await api.create(selectedReportItemIds);
              toast.success(`สร้าง ${created.exportNo} แล้ว`);
              setCreating(false);
              await open(created.id);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "สร้างรายการส่งออกไม่สำเร็จ");
              await api.reload();
              throw error;
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {details && (
        <RubberExportDetailModal
          key={details.id}
          details={details}
          canVerify={api.permissions.canVerify}
          shareBusy={pdfShare.busy}
          sharing={sharingId === details.id}
          onSave={async (values) => {
            try {
              await api.update(details.id, values);
              setDetails(await api.details(details.id));
              toast.success("บันทึกฉบับร่างแล้ว");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
              throw error;
            }
          }}
          onVerify={async (destination, values) => {
            try {
              if (values.currentWeight === null || values.workRate === null) return;
              await api.verify(details.id, destination, {
                currentWeight: values.currentWeight,
                workRate: values.workRate,
                otherOperatingCost: values.otherOperatingCost,
              });
              setDetails(await api.details(details.id));
              toast.success("ตรวจสอบรายการแล้ว");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "ตรวจสอบไม่สำเร็จ");
              throw error;
            }
          }}
          onShare={() => void share(details)}
          onClose={() => setDetails(null)}
        />
      )}

      {pendingDelete && (
        <ModalShell
          role="alertdialog"
          title={`ลบ ${pendingDelete.exportNo}?`}
          subtitle="รายการจะถูกเก็บเป็นประวัติ และบิลทั้งหมดจะถูกคืนให้ใช้งานได้อีกครั้ง"
          onClose={() => {
            if (!deleting) setPendingDelete(null);
          }}
        >
          <p className="text-pretty text-sm text-ink/70">ยืนยันการลบรายการส่งออกยางนี้ การลบจะบันทึกผู้ดำเนินการและเวลาไว้ในประวัติ</p>
          <div className="modal-actions mt-5 flex justify-end gap-2">
            <button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white disabled:opacity-50">ยกเลิก</button>
            <button type="button" disabled={deleting} onClick={() => void remove(pendingDelete)} className="focus-ring inline-flex items-center gap-2 rounded-md bg-clay px-4 py-2 font-semibold text-white disabled:opacity-50">
              {deleting && <RotateCw size={16} className="animate-spin" />} ยืนยันลบ
            </button>
          </div>
        </ModalShell>
      )}

      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </section>
  );
}
