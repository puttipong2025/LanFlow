"use client";

import { useEffect, useRef, useState } from "react";
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
    rubberValueAmount: item.rubberValueAmount,
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
    rubberValueTotal: details.rubberValueTotal,
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
      rubberValueAmount: item.rubberValueAmount,
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
  const [view, setView] = useState<"active" | "history" | "deletions">("active");
  const operationalView = view === "history" ? "history" : "active";
  const api = useRubberExports(selectedLocation.id, online, operationalView);
  const reloadDeletions = api.reloadDeletions;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RubberExportDetails | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [details, setDetails] = useState<RubberExportDetails | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RubberExportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteRequestVersion = useRef(0);
  const [pendingSale, setPendingSale] = useState<{
    row: RubberExportSummary;
    soldOut: boolean;
  } | null>(null);
  const [selling, setSelling] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const pdfShare = useSharePdf();

  useEffect(() => {
    setPendingDelete(null);
    setDeleting(false);
    return () => { deleteRequestVersion.current += 1; };
  }, [selectedLocation.id]);

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
    if (!online || deleting || api.deletionRefreshing || row.reportLockNo || row.receiptBillNo || row.soldOutAt) return;
    const request = ++deleteRequestVersion.current;
    setDeleting(true);
    try {
      await api.remove(row.id);
      if (request !== deleteRequestVersion.current) return;
      toast.success(`ลบ ${row.exportNo} แล้ว`);
      if (details?.id === row.id) closeDetails();
      setPendingDelete(null);
    } catch (error) {
      if (request !== deleteRequestVersion.current) return;
      toast.error(error instanceof Error ? error.message : "ลบรายการส่งออกไม่สำเร็จ");
    } finally {
      if (request === deleteRequestVersion.current) setDeleting(false);
    }
  }

  async function startEdit(row: RubberExportSummary) {
    if (row.status !== "draft" || !online) return;
    try {
      const [nextDetails] = await Promise.all([
        details?.id === row.id ? Promise.resolve(details) : api.details(row.id),
        api.loadAvailableBills("edit", row.id),
      ]);
      setEditing(nextDetails);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายการสำหรับแก้ไม่สำเร็จ");
    }
  }

  async function changeSoldOut() {
    if (!pendingSale) return;
    if (!pendingSale.soldOut && pendingSale.row.hasWexReservation) {
      toast.error("รายการนี้ถูกจองในบิลรถส่งออก จึงยกเลิกขายไม่ได้");
      setPendingSale(null);
      return;
    }
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
          <button type="button" onClick={() => void (view === "deletions" ? api.reloadDeletions() : api.reload())} disabled={!online || api.loading || api.deletionsLoading} className="focus-ring inline-flex items-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50">
            <RotateCw size={16} className={api.loading || api.deletionsLoading ? "animate-spin" : ""} /> รีเฟรช
          </button>
          {view === "active" && <button
            type="button"
            onClick={() => void api.loadAvailableBills("create").then((bills) => {
              if (bills.length === 0) {
                toast.info("ยังไม่มีบิลที่พร้อมส่งออก กรุณาสร้างรายงานที่ล็อกบิลก่อน");
                return;
              }
              setCreating(true);
            }).catch((error) => toast.error(error instanceof Error ? error.message : "โหลดบิลที่พร้อมส่งออกไม่สำเร็จ"))}
            disabled={!online || api.optionsLoading}
            title={!online ? "ต้องออนไลน์ก่อนสร้างรายการ" : "สร้างรายการส่งออกยาง"}
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <FilePlus2 size={16} /> {api.optionsLoading ? "กำลังเตรียม..." : "สร้างรายการ"}
          </button>}
        </div>
      </div>

      {!online && <div className="rounded-lg bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">ส่งออกยางใช้ได้เมื่อออนไลน์เท่านั้น</div>}
      {api.deletionRefreshError && (
        <div role="status" className="space-y-2 rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
          <p className="text-pretty">{api.deletionRefreshError} ไม่ต้องลบรายการซ้ำ</p>
          <button type="button" onClick={() => void api.refreshAfterDelete()} disabled={!online || api.deletionRefreshing}
            className="focus-ring rounded-md bg-actionSecondary px-3 py-2 text-white disabled:opacity-50">
            {api.deletionRefreshing ? "กำลังโหลดข้อมูล" : "โหลดข้อมูลใหม่"}
          </button>
        </div>
      )}
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
      <div className="flex flex-wrap gap-2" aria-label="มุมมองรายการส่งออกยาง">
        {([
          ["active", "กำลังดำเนินการ"],
          ["history", "ประวัติ"],
          ...(api.permissions.canDelete ? [["deletions", "ประวัติการลบ"]] as const : []),
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

      {view !== "deletions" ? (
      <>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <RubberExportTable
          rows={api.exports}
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
      {api.hasMore && !api.loading && (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-field px-4 py-3 text-center">
          <p className="text-sm text-ink/65">โหลดแล้ว {api.exports.length} รายการ</p>
          <button type="button" onClick={() => void api.loadMore()} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">
            โหลดเพิ่ม
          </button>
        </div>
      )}
      {view === "active" && !api.loading && api.exports.length === 0 && (
        <button type="button" onClick={onOpenReports} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">
          ไปหน้ารายงานเพื่อเตรียมบิลส่งออก
        </button>
      )}
      </>
      ) : (
        <div className="space-y-3">
          <DeletionAuditTable
            rows={api.deletions}
            loading={api.deletionsLoading}
            emptyLabel="ยังไม่มีประวัติการลบรายการส่งออกยาง"
            showPreviousStatus
            originalActorLabel="ผู้สร้าง"
            onShowCurrent={() => setView("active")}
          />
          {api.deletionsHasMore && api.deletionsCursor && !api.deletionsLoading && (
            <div className="flex justify-center"><button type="button" onClick={() => void api.reloadDeletions(api.deletionsCursor, true)} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดประวัติเพิ่ม</button></div>
          )}
        </div>
      )}

      {creating && (
        <RubberExportCreateModal
          key={api.availableBills.map((bill) => bill.reportItemId).join(",")}
          availableBills={api.availableBills}
          onPreview={(selectedReportItemIds, signal) => api.preview(selectedReportItemIds, undefined, signal)}
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
          onPreview={(selectedReportItemIds, signal) => api.preview(selectedReportItemIds, editing.id, signal)}
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
        confirmClassName={pendingSale?.soldOut ? "bg-commit/90 hover:bg-commit" : undefined}
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
