"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types";
import type {
  RubberExportAvailableBill,
  RubberExportDetails,
  RubberExportPreview,
  RubberExportSummary,
} from "@/types/rubber-exports";
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
import { AlertDialog } from "@/components/shared/AlertDialog";
import { DeletionAuditTable } from "@/components/shared/DeletionAuditTable";

type Filter = "sold" | "draft" | "verified" | "all";
type DetailTarget = Pick<RubberExportSummary, "id" | "exportNo">;

function editableBills(
  details: RubberExportDetails,
  availableBills: RubberExportAvailableBill[],
) {
  const rows = new Map<string, RubberExportAvailableBill>();
  details.items.forEach((item) => rows.set(item.sourceReportItemId, {
    reportItemId: item.sourceReportItemId,
    billId: item.sourceBillId,
    billDate: item.billDate,
    billNo: item.billNo,
    customerName: item.customerName,
    eligibilityAt: item.eligibilityAt,
    netWeight: item.netWeight,
    paidAmount: item.paidAmount,
  }));
  availableBills.forEach((bill) => rows.set(bill.reportItemId, bill));
  return Array.from(rows.values()).sort((left, right) =>
    left.eligibilityAt.localeCompare(right.eligibilityAt)
    || left.billId.localeCompare(right.billId)
  );
}

function editPreview(details: RubberExportDetails): RubberExportPreview {
  return {
    itemCount: details.items.length,
    originalWeightTotal: details.originalWeightTotal,
    paidTotal: details.paidTotal,
    averagePrice: details.averagePrice,
    calculatedAt: details.ageCalculatedAt ?? details.createdAt,
    averageAgeHours: details.averageAgeHours ?? 0,
    oldestAgeHours: details.oldestAgeHours ?? 0,
    estimatedAgeItemCount: details.estimatedAgeItemCount ?? 0,
    items: details.items.map((item) => ({
      reportItemId: item.sourceReportItemId,
      billId: item.sourceBillId,
      billDate: item.billDate,
      billNo: item.billNo,
      customerName: item.customerName,
      eligibilityAt: item.eligibilityAt,
      netWeight: item.netWeight,
      paidAmount: item.paidAmount,
      ageHours: item.ageHours ?? 0,
      ageIsEstimated: item.ageIsEstimated,
    })),
  };
}

function RubberExportDetailOpeningModal({
  target,
  error,
  onClose,
}: {
  target: DetailTarget;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title={target.exportNo}
      subtitle={error ? "โหลดรายละเอียดไม่สำเร็จ" : "กำลังโหลดรายละเอียดรายการส่งออกยาง"}
      onClose={onClose}
      size="wide"
    >
      {error ? (
        <div className="grid min-h-64 place-items-center px-4 text-center">
          <div>
            <h3 className="text-balance text-lg font-bold text-danger">โหลดรายละเอียดไม่สำเร็จ</h3>
            <p role="alert" className="mt-2 text-pretty text-sm font-semibold text-danger">{error}</p>
            <p className="mt-2 text-pretty text-sm text-ink/60">ปิดแล้วเปิดรายการอีกครั้งเพื่อลองใหม่</p>
          </div>
        </div>
      ) : (
        <div
          className="space-y-4"
          role="status"
          aria-label="กำลังโหลดรายละเอียดรายการส่งออกยาง"
        >
          <p className="text-pretty text-sm font-semibold text-ink/60">กำลังโหลดรายละเอียด...</p>
          <div className="grid gap-3 sm:grid-cols-5" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-16 rounded-md bg-black/5" />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-5" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-11 rounded-md bg-black/5" />
            ))}
          </div>
          <div className="h-10 rounded-md bg-mint/45" aria-hidden="true" />
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-9 rounded-md bg-black/5" />
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

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
  const reloadDeletions = api.reloadDeletions;
  const [view, setView] = useState<"current" | "deletions">("current");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RubberExportDetails | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [details, setDetails] = useState<RubberExportDetails | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RubberExportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingSale, setPendingSale] = useState<{
    row: RubberExportSummary;
    soldOut: boolean;
  } | null>(null);
  const [selling, setSelling] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const pdfShare = useSharePdf();
  const counts = useMemo(() => ({
    sold: api.exports.filter((row) => Boolean(row.soldOutAt)).length,
    draft: api.exports.filter((row) => row.status === "draft").length,
    verified: api.exports.filter((row) => row.status === "verified").length,
    all: api.exports.length,
  }), [api.exports]);
  const visibleRows = useMemo(() => api.exports
    .filter((row) => {
      if (filter === "all") return true;
      if (filter === "sold") return Boolean(row.soldOutAt);
      return row.status === filter;
    })
    .sort((left, right) => {
      const rank = { draft: 0, verified: 1 };
      const statusDifference = rank[left.status] - rank[right.status];
      if (statusDifference !== 0) return statusDifference;
      const timeDifference = left.createdAt.localeCompare(right.createdAt);
      if (timeDifference !== 0) return left.status === "draft" ? timeDifference : -timeDifference;
      return left.id.localeCompare(right.id);
    }), [api.exports, filter]);

  useEffect(() => {
    if (view === "deletions") void reloadDeletions();
  }, [reloadDeletions, selectedLocation.id, view]);

  async function open(target: DetailTarget) {
    if (!online) return;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailTarget(target);
    setDetails(null);
    setDetailError(null);

    try {
      const next = await api.details(target.id, controller.signal);
      if (detailController.current === controller) {
        setDetails(next);
        onInitialExportHandled?.();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (detailController.current === controller) {
        setDetailError(error instanceof Error ? error.message : "โหลดรายการส่งออกไม่สำเร็จ");
      }
    } finally {
      if (detailController.current === controller) detailController.current = null;
    }
  }

  function closeDetails() {
    detailController.current?.abort();
    detailController.current = null;
    setDetailTarget(null);
    setDetails(null);
    setDetailError(null);
  }

  useEffect(() => () => detailController.current?.abort(), []);

  useEffect(() => {
    if (initialExportId && online) {
      void open({
        id: initialExportId,
        exportNo: api.exports.find((row) => row.id === initialExportId)?.exportNo
          ?? "รายการส่งออกยาง",
      });
    }
    // Opening is intentionally keyed only by the source ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExportId, online]);

  async function remove(row: RubberExportSummary) {
    if (row.reportLockNo || row.receiptBillNo || row.soldOutAt) return;
    setDeleting(true);
    try {
      await api.remove(row.id);
      toast.success(`ลบ ${row.exportNo} แล้ว`);
      if (details?.id === row.id) closeDetails();
      setPendingDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบรายการส่งออกไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  async function startEdit(row: RubberExportSummary) {
    if (row.status !== "draft" || !online) return;
    try {
      setEditing(details?.id === row.id ? details : await api.details(row.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายการสำหรับแก้ไม่สำเร็จ");
    }
  }

  async function changeSoldOut() {
    if (!pendingSale) return;
    setSelling(true);
    try {
      await api.setSoldOut(pendingSale.row.id, pendingSale.soldOut);
      if (details?.id === pendingSale.row.id) {
        setDetails(await api.details(details.id));
      }
      toast.success(pendingSale.soldOut ? "ขายยางออกแล้ว" : "ยกเลิกขายแล้ว");
      setPendingSale(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปลี่ยนสถานะขายไม่สำเร็จ");
    } finally {
      setSelling(false);
    }
  }

  async function share(row: Pick<RubberExportSummary, "id" | "exportNo">) {
    if (!online || pdfShare.busy) return;
    setSharingId(row.id);
    try {
      const delivery = await pdfShare.sharePdfFile(async (signal) => {
        const freshDetails = await api.details(row.id, signal);
        if (freshDetails.status === "draft") {
          throw new Error("แชร์ PDF ได้เฉพาะรายการตรวจสอบแล้ว");
        }
        const officialDetails = {
          ...freshDetails,
          ageCalculatedAt: freshDetails.officialAgeCutoffAt ?? freshDetails.ageCalculatedAt,
          averageAgeHours: freshDetails.officialAverageAgeHours ?? freshDetails.averageAgeHours,
          oldestAgeHours: freshDetails.officialOldestAgeHours ?? freshDetails.oldestAgeHours,
          estimatedAgeItemCount: freshDetails.officialEstimatedAgeItemCount
            ?? freshDetails.estimatedAgeItemCount,
          items: freshDetails.items.map((item) => ({
            ...item,
            ageHours: item.officialAgeHours ?? item.ageHours,
          })),
        };
        return {
          file: await createRubberExportPdfFile(officialDetails, signal),
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
          <button type="button" onClick={() => void (view === "current" ? api.reload() : api.reloadDeletions())} disabled={!online || api.loading || api.deletionsLoading} className="focus-ring inline-flex items-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50">
            <RotateCw size={16} className={api.loading || api.deletionsLoading ? "animate-spin" : ""} /> รีเฟรช
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
      {online && view === "deletions" && api.deletionsError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {api.deletionsError}
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

      <div className="flex flex-wrap gap-2" aria-label="มุมมองรายการส่งออกยาง">
        {([
          ["current", "รายการปัจจุบัน"],
          ["deletions", "ประวัติการลบ"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setView(value);
            }}
            className={cn(
              "focus-ring rounded-md px-4 py-2 text-sm font-semibold text-white",
              view === value ? "bg-leaf" : "bg-actionSecondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "current" && <div className="flex flex-wrap gap-2">
        {([
          ["sold", "ขายออกแล้ว"],
          ["draft", "ฉบับร่าง"],
          ["verified", "ตรวจสอบแล้ว"],
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
      </div>}

      {view === "current" ? (
      !api.loading && api.exports.length > 0 && visibleRows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg bg-field px-4 py-5">
          <div>
            <p className="font-semibold text-ink">ไม่มีรายการในตัวกรองนี้</p>
            <p className="mt-1 text-pretty text-sm text-ink/65">เลือกดูรายการทั้งหมดเพื่อกลับไปจัดการรายการส่งออกยาง</p>
          </div>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white"
          >
            แสดงทั้งหมด
          </button>
        </div>
      ) : (
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <RubberExportTable
          rows={visibleRows}
          loading={api.loading}
          online={online}
          canDelete={api.permissions.canDelete}
          canVerify={api.permissions.canVerify}
          shareBusy={pdfShare.busy}
          sharingId={sharingId}
          onOpen={(id) => {
            const target = api.exports.find((row) => row.id === id);
            if (target) void open(target);
          }}
          onEdit={(row) => void startEdit(row)}
          onSale={(row, soldOut) => setPendingSale({ row, soldOut })}
          onShare={(row) => void share(row)}
          onDelete={setPendingDelete}
        />
      </div>
      )
      ) : (
        <DeletionAuditTable
          rows={api.deletions}
          loading={api.deletionsLoading}
          emptyLabel="ยังไม่มีประวัติการลบรายการส่งออกยาง"
          showPreviousStatus
          onShowCurrent={() => setView("current")}
        />
      )}

      {creating && (
        <RubberExportCreateModal
          key={api.availableBills.map((bill) => bill.reportItemId).join(",")}
          availableBills={api.availableBills}
          onPreview={api.preview}
          onSubmit={async (selectedReportItemIds) => {
            try {
              const created = await api.create(selectedReportItemIds);
              toast.success(`สร้าง ${created.exportNo} แล้ว`);
              setCreating(false);
              await open(created);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "สร้างรายการส่งออกไม่สำเร็จ");
              await api.reload();
              throw error;
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <RubberExportCreateModal
          key={`edit-${editing.id}-${api.availableBills.map((bill) => bill.reportItemId).join(",")}`}
          mode="edit"
          availableBills={editableBills(editing, api.availableBills)}
          initialSelectedIds={editing.items.map((item) => item.sourceReportItemId)}
          initialPreview={editPreview(editing)}
          onPreview={(selectedReportItemIds) => api.preview(selectedReportItemIds, editing.id)}
          onSubmit={async (selectedReportItemIds) => {
            try {
              await api.replaceItems(editing.id, selectedReportItemIds);
              if (details?.id === editing.id) setDetails(await api.details(editing.id));
              toast.success("แก้รายการส่งออกยางแล้ว");
              setEditing(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "แก้รายการส่งออกไม่สำเร็จ");
              await api.reload();
              throw error;
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {detailTarget && !details && (
        <RubberExportDetailOpeningModal
          target={detailTarget}
          error={detailError}
          onClose={closeDetails}
        />
      )}

      {details && (
        <RubberExportDetailModal
          key={[
            details.id,
            details.status,
            details.originalWeightTotal,
            details.currentWeight ?? "",
            details.workRate ?? "",
            details.otherOperatingCost,
            details.items.map((item) => item.id).join(","),
          ].join(":")}
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
          onClose={closeDetails}
        />
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        title={`ลบ ${pendingDelete?.exportNo ?? "รายการส่งออกยาง"} แบบถาวร?`}
        description="รายการ บิล snapshot และรายละเอียดทั้งหมดจะถูกลบถาวรและกู้คืนไม่ได้ บิลต้นทางจะกลับมาใช้งานได้ และระบบจะเก็บเฉพาะประวัติการลบขั้นต่ำ"
        confirmLabel="ยืนยันลบ"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />

      <AlertDialog
        open={Boolean(pendingSale)}
        title={pendingSale?.soldOut ? "ยืนยันขายยางออก?" : "ยืนยันยกเลิกขาย?"}
        description={pendingSale?.soldOut
          ? `${pendingSale.row.exportNo} จะไม่สามารถเลือกรับยางจากสาขาหรือลบได้จนกว่าจะยกเลิกขาย`
          : `${pendingSale?.row.exportNo ?? "รายการนี้"} จะกลับเป็นรายการตรวจสอบแล้วที่พร้อมรับยาง`}
        confirmLabel={pendingSale?.soldOut ? "ยืนยันขายยางออก" : "ยกเลิกขาย"}
        busy={selling}
        onCancel={() => {
          if (!selling) setPendingSale(null);
        }}
        onConfirm={() => void changeSoldOut()}
      />

      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </section>
  );
}
