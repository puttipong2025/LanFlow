"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Location, Profile } from "@/types";
import type { RubberExportDetails, RubberExportStatus, RubberExportSummary } from "@/types/rubber-exports";
import { canManageSystemFeatures } from "@/lib/permissions";
import { useRubberExports } from "@/hooks/useRubberExports";
import { RubberExportCreateModal } from "@/components/rubber-exports/RubberExportCreateModal";
import { RubberExportDetailModal } from "@/components/rubber-exports/RubberExportDetailModal";
import { RubberExportTable } from "@/components/rubber-exports/RubberExportTable";

type Filter = "active" | RubberExportStatus | "all";

export function RubberExportsModule({
  selectedLocation,
  profile,
  online,
  initialExportId,
  onInitialExportHandled,
}: {
  selectedLocation: Location;
  profile: Profile;
  online: boolean;
  initialExportId?: string | null;
  onInitialExportHandled?: () => void;
}) {
  const api = useRubberExports(selectedLocation.id, online);
  const [filter, setFilter] = useState<Filter>("active");
  const [creating, setCreating] = useState(false);
  const [details, setDetails] = useState<RubberExportDetails | null>(null);
  const canVerifyOrDelete = canManageSystemFeatures(profile);
  const visibleRows = useMemo(() => api.exports.filter((row) => {
    if (filter === "all") return true;
    if (filter === "active") return row.status !== "deleted";
    return row.status === filter;
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
    if (row.reportLockNo || !window.confirm(`ลบ ${row.exportNo} และคืนบิลทั้งหมดหรือไม่?`)) return;
    try {
      await api.remove(row.id);
      toast.success(`ลบ ${row.exportNo} แล้ว`);
      if (details?.id === row.id) setDetails(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบรายการส่งออกไม่สำเร็จ");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-ink">ส่งออกยาง — {selectedLocation.name}</h2>
          <p className="mt-1 text-sm text-ink/65">เลือก cutoff จากบิลที่ล็อกในรายงาน และจองบิลทันทีเมื่อสร้างฉบับร่าง</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void api.reload()} disabled={!online || api.loading} className="focus-ring inline-flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">
            <RotateCw size={16} className={api.loading ? "animate-spin" : ""} /> รีเฟรช
          </button>
          <button type="button" onClick={() => setCreating(true)} disabled={!online || api.cutoffOptions.length === 0} className="focus-ring inline-flex items-center gap-2 rounded-md bg-leaf px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
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
      {online && !api.loading && !api.error && api.cutoffOptions.length === 0 && (
        <div className="rounded-lg bg-field px-4 py-3 text-sm text-ink/65">ยังไม่มีบิลที่ล็อกจากรายงานและพร้อมส่งออก</div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          ["active", "ใช้งาน"],
          ["draft", "ฉบับร่าง"],
          ["verified", "ตรวจสอบแล้ว"],
          ["deleted", "ลบแล้ว"],
          ["all", "ทั้งหมด"],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`focus-ring rounded-md px-3 py-1.5 text-sm font-semibold ${filter === value ? "bg-ink text-white" : "bg-white text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <RubberExportTable
          rows={visibleRows}
          loading={api.loading}
          canDelete={canVerifyOrDelete}
          onOpen={(id) => void open(id)}
          onDelete={(row) => void remove(row)}
        />
      </div>

      {creating && (
        <RubberExportCreateModal
          options={api.cutoffOptions}
          onPreview={api.preview}
          onCreate={async (cutoffReportItemId) => {
            try {
              const created = await api.create(cutoffReportItemId);
              toast.success(`สร้าง ${created.exportNo} แล้ว`);
              setCreating(false);
              await open(created.id);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "สร้างรายการส่งออกไม่สำเร็จ");
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {details && (
        <RubberExportDetailModal
          key={details.id}
          details={details}
          canVerify={canVerifyOrDelete}
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
              await api.update(details.id, values);
              await api.verify(details.id, destination);
              setDetails(await api.details(details.id));
              toast.success("ตรวจสอบรายการแล้ว");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "ตรวจสอบไม่สำเร็จ");
              throw error;
            }
          }}
          onClose={() => setDetails(null)}
        />
      )}
    </section>
  );
}
