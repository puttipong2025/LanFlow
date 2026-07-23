"use client";

import { useCallback, useEffect, useState } from "react";
import { FilePlus2, Loader2, Printer, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Location, Profile } from "@/types";
import type { ReportSummary } from "@/types/reports";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures } from "@/lib/permissions";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function ReportsModule({
  selectedLocation,
  profile,
  online,
}: {
  selectedLocation: Location;
  profile: Profile;
  online: boolean;
}) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
      await assertApiResponse(response);
      const created = await response.json() as { id: string; reportNo: string };
      toast.success(`สร้าง ${created.reportNo} แล้ว`);
      await loadReports();
      window.open(`/reports/${created.id}/print`, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างรายงานไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function deleteReport(report: ReportSummary) {
    if (!report.isLatestActive || !canDelete || deletingId) return;
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-ink">ชุดรายงาน — {selectedLocation.name}</h2>
          <p className="mt-1 text-sm text-ink/65">
            เมื่อสร้างสำเร็จ รายการทั้งหมดใน cutoff จะถูกล็อกทันที แม้ปิดหน้าพิมพ์
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={!online || loading}
            className="focus-ring inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RotateCw size={16} className={loading ? "animate-spin" : ""} />
            รีเฟรช
          </button>
          <button
            type="button"
            onClick={() => void createReport()}
            disabled={!online || creating}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-leaf px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
          <table className="min-w-full text-sm">
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
                    {report.status === "active" ? "ใช้งาน" : `ลบแล้ว${report.deletedAt ? ` ${dateTime(report.deletedAt)}` : ""}`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <a
                        href={`/reports/${report.id}/print`}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring inline-flex items-center gap-1 rounded-md bg-river px-3 py-1.5 font-semibold text-white"
                      >
                        <Printer size={15} />
                        ดู/พิมพ์
                      </a>
                      {canDelete && report.status === "active" && report.isLatestActive && (
                        <button
                          type="button"
                          onClick={() => void deleteReport(report)}
                          disabled={deletingId === report.id}
                          title="ลบรายงานล่าสุดเพื่อปลดล็อกรายการ"
                          className="focus-ring inline-flex items-center gap-1 rounded-md bg-clay px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                        >
                          {deletingId === report.id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Trash2 size={15} />}
                          ลบ
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
  );
}
