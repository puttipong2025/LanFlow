"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleDollarSign, Eye, FilePlus2, Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Location, Profile } from "@/types";
import type { ReportDetails, ReportSummary } from "@/types/reports";
import type { DocumentDeletionAudit } from "@/types/deletion-audits";
import { ApiResponseError, assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { ReportPreviewModal } from "@/components/reports/ReportPreviewModal";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { DeletionAuditTable } from "@/components/shared/DeletionAuditTable";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function showCreateReportError(groups: string[]) {
  toast.error("สร้างรายงานไม่สำเร็จ", {
    description: (
      <div>
        <div>คาดว่าเกิดจาก:</div>
        <div role="list" aria-label="กลุ่มที่คาดว่าเกิดข้อผิดพลาด">
          {groups.map((group) => (
            <div key={group} role="listitem">{group}</div>
          ))}
        </div>
      </div>
    ),
  });
}

export function ReportsModule({
  selectedLocation,
  profile,
  online,
  onOpenCashCount,
}: {
  selectedLocation: Location;
  profile: Profile;
  online: boolean;
  onOpenCashCount?: (countId: string) => void;
}) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [deletions, setDeletions] = useState<DocumentDeletionAudit[]>([]);
  const [view, setView] = useState<"current" | "deletions">("current");
  const [loading, setLoading] = useState(true);
  const [deletionsLoading, setDeletionsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReportSummary | null>(null);
  const [previewReport, setPreviewReport] = useState<ReportSummary | null>(null);
  const [previewDetails, setPreviewDetails] = useState<ReportDetails | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);
  const deletionController = useRef<AbortController | null>(null);
  const locationIdRef = useRef(selectedLocation.id);
  locationIdRef.current = selectedLocation.id;
  const [reportsHasMore, setReportsHasMore] = useState(false);
  const [reportsCursor, setReportsCursor] = useState<string | null>(null);
  const [deletionsHasMore, setDeletionsHasMore] = useState(false);
  const [deletionsCursor, setDeletionsCursor] = useState<string | null>(null);
  const canDelete = canManageSystemFeatures(profile);

  const loadReports = useCallback(async (cursor: string | null = null, append = false) => {
    if (!online) return;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ locationId: selectedLocation.id });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/reports?${params.toString()}`,
        { cache: "no-store", signal: controller.signal }
      );
      await assertApiResponse(response);
      const body = await response.json() as { reports: ReportSummary[]; hasMore: boolean; nextCursor: string | null };
      if (controller.signal.aborted || locationIdRef.current !== selectedLocation.id) return;
      setReports((current) => append
        ? [...current, ...body.reports.filter((row) => !current.some((item) => item.id === row.id))]
        : body.reports);
      setReportsHasMore(body.hasMore);
      setReportsCursor(body.nextCursor);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "โหลดรายงานไม่สำเร็จ");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [online, selectedLocation.id]);

  const loadDeletions = useCallback(async (cursor: string | null = null, append = false) => {
    if (!online) return;
    deletionController.current?.abort();
    const controller = new AbortController();
    deletionController.current = controller;
    setDeletionsLoading(true);
    try {
      const params = new URLSearchParams({ locationId: selectedLocation.id, view: "deletions" });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/reports?${params.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        deletions: DocumentDeletionAudit[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (controller.signal.aborted || locationIdRef.current !== selectedLocation.id) return;
      setDeletions((current) => append
        ? [...current, ...body.deletions.filter((row) => !current.some((item) => item.id === row.id))]
        : body.deletions);
      setDeletionsHasMore(body.hasMore);
      setDeletionsCursor(body.nextCursor);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "โหลดประวัติการลบไม่สำเร็จ");
    } finally {
      if (!controller.signal.aborted) setDeletionsLoading(false);
    }
  }, [online, selectedLocation.id]);

  useEffect(() => {
    setReports([]);
    setDeletions([]);
    if (view === "current") void loadReports();
    else void loadDeletions();
    return () => {
      listController.current?.abort();
      deletionController.current?.abort();
    };
  }, [loadDeletions, loadReports, selectedLocation.id, view]);

  useEffect(() => () => previewController.current?.abort(), []);

  async function openReportPreview(report: ReportSummary) {
    if (!online) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreviewReport(report);
    setPreviewDetails(null);
    setPreviewError(null);

    try {
      const response = await authFetch(`/api/lanflow/reports/${report.id}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      await assertApiResponse(response);
      const details = await response.json() as ReportDetails;
      if (previewController.current === controller) setPreviewDetails(details);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (previewController.current === controller) {
        setPreviewError(error instanceof Error ? error.message : "โหลดรายละเอียดรายงานไม่สำเร็จ");
      }
    } finally {
      if (previewController.current === controller) previewController.current = null;
    }
  }

  function closeReportPreview() {
    previewController.current?.abort();
    previewController.current = null;
    setPreviewReport(null);
    setPreviewDetails(null);
    setPreviewError(null);
  }

  async function createReport() {
    if (!online || creating) return;
    setCreating(true);
    try {
      const response = await authFetch("/api/lanflow/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: selectedLocation.id }),
      });
      const errorBody = !response.ok
        ? await response.clone().json().catch(() => null) as { errorGroups?: unknown } | null
        : null;
      const errorGroups = Array.isArray(errorBody?.errorGroups)
        ? errorBody.errorGroups.filter((group): group is string => typeof group === "string")
        : [];
      if (errorGroups.length > 0) {
        showCreateReportError(errorGroups);
        return;
      }
      await assertApiResponse(response);
      const created = await response.json() as { id: string; reportNo: string };
      toast.success(`สร้าง ${created.reportNo} แล้ว`);
      await loadReports();
    } catch (error) {
      if (
        error instanceof ApiResponseError
        && (error.status === 401 || error.status === 403 || error.message.includes("ไม่มีรายการ"))
      ) {
        toast.error(error.message);
      } else {
        console.error("create report request failed", error);
        showCreateReportError(["ระบบรายงาน"]);
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteReport(report: ReportSummary) {
    if (!report.isLatestActive || !canDelete || deletingId || report.rubberExportLockNo) return;
    setDeletingId(report.id);
    try {
      const response = await authFetch(`/api/lanflow/reports/${report.id}`, {
        method: "DELETE",
      });
      await assertApiResponse(response);
      toast.success(`ลบ ${report.reportNo} แบบถาวรแล้ว`);
      setPendingDelete(null);
      await loadReports();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบรายงานไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
    <section className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:p-4">
        <div>
          <h2 className="text-balance text-xl font-bold text-ink">ชุดรายงาน — {selectedLocation.name}</h2>
          <p className="mt-1 text-pretty text-sm text-ink/65">
            เมื่อสร้างสำเร็จ รายการทั้งหมดใน cutoff จะถูกล็อกทันที แม้ปิดหน้าพิมพ์
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => void (view === "current" ? loadReports() : loadDeletions())}
            disabled={!online || loading || deletionsLoading}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50"
          >
            <RotateCw size={16} className={loading || deletionsLoading ? "animate-spin" : ""} />
            รีเฟรช
          </button>
          {view === "current" && <button
            type="button"
            onClick={() => void createReport()}
            disabled={!online || creating}
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />}
            สร้างรายงาน
          </button>}
        </div>
      </div>

      {!online && (
        <div className="rounded-lg bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
          รายงานใช้ได้เมื่อออนไลน์เท่านั้น
        </div>
      )}

      <div className="flex flex-wrap gap-2" aria-label="มุมมองรายงาน">
        {([
          ["current", "รายการปัจจุบัน"],
          ...(canDelete ? [["deletions", "ประวัติการลบ"]] as const : []),
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={cn(
              "focus-ring rounded-md px-4 py-2 text-sm font-semibold text-white",
              view === value ? "bg-leaf" : "bg-actionSecondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "current" ? (
      <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-mint/60 text-left text-ink">
              <tr>
                <th className="px-4 py-3">จัดการ</th>
                <th className="px-4 py-3">เลขรายงาน</th>
                <th className="px-4 py-3">Cutoff</th>
                <th className="px-4 py-3">ผู้สร้าง</th>
                <th className="px-4 py-3 text-right">จำนวนรายการ</th>
                <th className="px-4 py-3">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/60">กำลังโหลด...</td></tr>
              )}
              {!loading && reports.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/60">ยังไม่มีรายงาน</td></tr>
              )}
              {!loading && reports.map((report) => (
                <tr key={report.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <button type="button" onClick={() => void openReportPreview(report)} disabled={!online}
                        title={!online ? "ดูรายงานได้เมื่อออนไลน์" : `ดูรายงาน ${report.reportNo}`}
                        aria-label={!online ? "ดูรายงานได้เมื่อออนไลน์" : `ดูรายงาน ${report.reportNo}`}
                        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-river text-white disabled:opacity-45">
                        <Eye size={17} />
                      </button>
                      {canDelete && report.hasCashCount && report.cashCountId && onOpenCashCount && (
                        <button type="button" onClick={() => onOpenCashCount(report.cashCountId!)} title="เปิดผลตรวจนับ" aria-label="เปิดผลตรวจนับ"
                          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-actionSecondary text-white">
                          <CircleDollarSign size={17} />
                        </button>
                      )}
                      {canDelete && report.isLatestActive && !report.hasCashCount && (
                        <button type="button" onClick={() => setPendingDelete(report)}
                          disabled={deletingId === report.id || Boolean(report.rubberExportLockNo)}
                          title={report.rubberExportLockNo ? `ต้องลบรายการส่งออกยาง ${report.rubberExportLockNo} ก่อน` : "ลบรายงานล่าสุดเพื่อปลดล็อกรายการ"}
                          aria-label={report.rubberExportLockNo ? `ต้องลบรายการส่งออกยาง ${report.rubberExportLockNo} ก่อน` : "ลบรายงานล่าสุดเพื่อปลดล็อกรายการ"}
                          className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-clay px-3 font-semibold text-white disabled:opacity-50">
                          {deletingId === report.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} ลบ
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold">{report.reportNo}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateTime(report.cutoffAt)}</td>
                  <td className="px-4 py-3">{report.createdByName}</td>
                  <td className="px-4 py-3 text-right">{report.itemCount.toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3">
                    <div>ใช้งาน</div>
                    <div className="mt-1 text-xs font-semibold text-ink/60">{report.hasCashCount ? "มีผลตรวจนับเงินสด" : "ไม่มีผลตรวจนับเงินสด"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {reportsHasMore && reportsCursor && !loading && (
        <div className="flex flex-col items-center gap-2 rounded-md bg-field px-4 py-3 text-center">
          <p className="text-sm text-ink/65">โหลดแล้ว {reports.length} รายงาน</p>
          <button type="button" onClick={() => void loadReports(reportsCursor, true)} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดเพิ่ม</button>
        </div>
      )}
      </div>
      ) : (
        <div className="space-y-3">
          <DeletionAuditTable
            rows={deletions}
            loading={deletionsLoading}
            emptyLabel="ยังไม่มีประวัติการลบรายงาน"
            onShowCurrent={() => setView("current")}
          />
          {deletionsHasMore && deletionsCursor && !deletionsLoading && (
            <div className="flex justify-center"><button type="button" onClick={() => void loadDeletions(deletionsCursor, true)} className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white">โหลดประวัติเพิ่ม</button></div>
          )}
        </div>
      )}
    </section>
    {previewReport && (
      <ReportPreviewModal
        report={previewReport}
        details={previewDetails}
        error={previewError}
        online={online}
        onClose={closeReportPreview}
      />
    )}
    <AlertDialog
      open={Boolean(pendingDelete)}
      title={`ลบ ${pendingDelete?.reportNo ?? "รายงาน"} แบบถาวร?`}
      description="รายการในรายงานจะถูกปลดล็อก แต่รายงานและรายละเอียดทั้งหมดจะถูกลบถาวรและกู้คืนไม่ได้ ระบบจะเก็บเฉพาะประวัติการลบขั้นต่ำ"
      confirmLabel="ลบ"
      busy={Boolean(deletingId)}
      onCancel={() => {
        if (!deletingId) setPendingDelete(null);
      }}
      onConfirm={() => {
        if (pendingDelete) void deleteReport(pendingDelete);
      }}
    />
    </>
  );
}
