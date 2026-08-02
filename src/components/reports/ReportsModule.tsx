"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleDollarSign, FilePlus2, Loader2, RotateCw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Location, Profile } from "@/types";
import type { ReportDetails, ReportSummary } from "@/types/reports";
import { ApiResponseError, assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures } from "@/lib/permissions";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import { createReportPdfFile } from "@/lib/reports/report-pdf";
import { reportShareTitle } from "@/lib/reports/report-presentation";

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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const pdfShare = useSharePdf();
  const canDelete = canManageSystemFeatures(profile);

  const loadReports = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      const response = await authFetch(
        `/api/lanflow/reports?locationId=${encodeURIComponent(selectedLocation.id)}`,
        { cache: "no-store" }
      );
      await assertApiResponse(response);
      const body = await response.json() as { reports: ReportSummary[] };
      setReports(body.reports);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลดรายงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [online, selectedLocation.id]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

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

  async function shareReport(report: ReportSummary) {
    if (!online || pdfShare.busy) return;
    setSharingId(report.id);
    try {
      const delivery = await pdfShare.sharePdfFile(async (signal) => {
        const response = await authFetch(`/api/lanflow/reports/${report.id}`, {
          cache: "no-store",
          signal,
        });
        await assertApiResponse(response);
        const details = await response.json() as ReportDetails;
        return {
          file: await createReportPdfFile(details, signal),
          title: reportShareTitle(details.report),
        };
      });
      if (delivery === "shared") {
        toast.success(`แชร์ ${report.reportNo} แล้ว`);
      } else if (delivery === "downloaded") {
        toast.info("อุปกรณ์นี้แชร์ไฟล์ไม่ได้ จึงดาวน์โหลด PDF แทนแล้ว");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF รายงานไม่สำเร็จ");
    } finally {
      setSharingId(null);
    }
  }

  async function deleteReport(report: ReportSummary) {
    if (!report.isLatestActive || !canDelete || deletingId || report.rubberExportLockNo) return;
    if (!window.confirm(`ลบ ${report.reportNo} เพื่อปลดล็อกรายการหรือไม่?`)) return;
    setDeletingId(report.id);
    try {
      const response = await authFetch(`/api/lanflow/reports/${report.id}`, {
        method: "DELETE",
      });
      await assertApiResponse(response);
      toast.success(`ลบ ${report.reportNo} แล้ว รายการในชุดนี้ถูกปลดล็อก`);
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
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div>
          <h2 className="text-balance text-xl font-bold text-ink">ชุดรายงาน — {selectedLocation.name}</h2>
          <p className="mt-1 text-pretty text-sm text-ink/65">
            เมื่อสร้างสำเร็จ รายการทั้งหมดใน cutoff จะถูกล็อกทันที แม้ปิดหน้าพิมพ์
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={!online || loading}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-actionSecondary px-3 py-2 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:opacity-50"
          >
            <RotateCw size={16} className={loading ? "animate-spin" : ""} />
            รีเฟรช
          </button>
          <button
            type="button"
            onClick={() => void createReport()}
            disabled={!online || creating}
            className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />}
            สร้างรายงาน
          </button>
        </div>
      </div>

      {!online && (
        <div className="rounded-lg bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
          รายงานใช้ได้เมื่อออนไลน์เท่านั้น
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-mint/60 text-left text-ink">
              <tr>
                <th className="px-4 py-3">เลขรายงาน</th>
                <th className="px-4 py-3">Cutoff</th>
                <th className="px-4 py-3">ผู้สร้าง</th>
                <th className="px-4 py-3 text-right">จำนวนรายการ</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3 text-right">การทำงาน</th>
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
                <tr key={report.id} className={report.status === "deleted" ? "bg-slate-50 text-ink/50" : ""}>
                  <td className="px-4 py-3 font-semibold">{report.reportNo}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateTime(report.cutoffAt)}</td>
                  <td className="px-4 py-3">{report.createdByName}</td>
                  <td className="px-4 py-3 text-right">{report.itemCount.toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3">
                    <div>{report.status === "active" ? "ใช้งาน" : `ลบแล้ว${report.deletedAt ? ` ${dateTime(report.deletedAt)}` : ""}`}</div>
                    <div className="mt-1 text-xs font-semibold text-ink/60">{report.hasCashCount ? "มีผลตรวจนับเงินสด" : "ไม่มีผลตรวจนับเงินสด"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void shareReport(report)}
                        disabled={!online || pdfShare.busy}
                        aria-label={`แชร์ PDF รายงาน ${report.reportNo}`}
                        className="focus-ring inline-flex items-center gap-1 rounded-md bg-river px-3 py-1.5 font-semibold text-white"
                      >
                        {sharingId === report.id
                          ? <Loader2 size={15} className="animate-spin" />
                          : <Share2 size={15} />}
                        {sharingId === report.id ? "กำลังสร้าง PDF" : "แชร์ PDF"}
                      </button>
                      {canDelete && report.status === "active" && report.hasCashCount && report.cashCountId && onOpenCashCount && (
                        <button type="button" onClick={() => onOpenCashCount(report.cashCountId!)} className="focus-ring inline-flex items-center gap-1 rounded-md bg-actionSecondary px-3 py-1.5 font-semibold text-white"><CircleDollarSign size={15} />เปิดผลนับ</button>
                      )}
                      {canDelete && report.status === "active" && report.isLatestActive && !report.hasCashCount && (
                        <button
                          type="button"
                          onClick={() => void deleteReport(report)}
                          disabled={deletingId === report.id || Boolean(report.rubberExportLockNo)}
                          title={report.rubberExportLockNo
                            ? `ต้องลบรายการส่งออกยาง ${report.rubberExportLockNo} ก่อน`
                            : "ลบรายงานล่าสุดเพื่อปลดล็อกรายการ"}
                          className="focus-ring inline-flex items-center gap-1 rounded-md bg-clay px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                        >
                          {deletingId === report.id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Trash2 size={15} />}
                          {report.rubberExportLockNo ? `ล็อกโดย ${report.rubberExportLockNo}` : "ลบ"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </>
  );
}
