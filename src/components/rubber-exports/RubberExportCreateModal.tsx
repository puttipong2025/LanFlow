"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import type {
  RubberExportAvailableBill,
  RubberExportPreview,
} from "@/types/rubber-exports";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";

function number(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RubberExportCreateModal({
  availableBills,
  onPreview,
  onCreate,
  onClose,
}: {
  availableBills: RubberExportAvailableBill[];
  onPreview: (reportItemIds: string[]) => Promise<RubberExportPreview>;
  onCreate: (reportItemIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<RubberExportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequest = useRef(0);

  async function changeSelection(reportItemIds: string[]) {
    const request = ++previewRequest.current;
    setSelectedIds(reportItemIds);
    setPreview(null);
    setError(null);
    if (reportItemIds.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextPreview = await onPreview(reportItemIds);
      if (request === previewRequest.current) setPreview(nextPreview);
    } catch (caught) {
      if (request === previewRequest.current) {
        setError(caught instanceof Error ? caught.message : "โหลด preview ไม่สำเร็จ");
      }
    } finally {
      if (request === previewRequest.current) setLoading(false);
    }
  }

  function toggle(reportItemId: string) {
    const next = selectedIds.includes(reportItemId)
      ? selectedIds.filter((id) => id !== reportItemId)
      : [...selectedIds, reportItemId];
    void changeSelection(next);
  }

  return (
    <ModalShell title="สร้างรายการส่งออกยาง" subtitle="เลือกบิลที่ต้องการจองสำหรับรายการนี้" onClose={onClose} size="wide">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-ink/70">
            เลือกแล้ว {selectedIds.length} จาก {availableBills.length} บิล
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={selectedIds.length === availableBills.length}
              onClick={() => void changeSelection(availableBills.map((bill) => bill.reportItemId))}
              className="focus-ring rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              เลือกทั้งหมด
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => void changeSelection([])}
              className="focus-ring rounded-md bg-actionSecondary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              ล้างที่เลือก
            </button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-md border border-black/10">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-mint">
              <tr>
                <th className="w-12 px-3 py-2 text-center">เลือก</th>
                <th className="px-3 py-2 text-left">วันที่</th>
                <th className="px-3 py-2 text-left">บิล</th>
                <th className="px-3 py-2 text-left">ลูกค้า</th>
                <th className="px-3 py-2 text-right">น้ำหนัก</th>
                <th className="px-3 py-2 text-right">จ่ายจริง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {availableBills.map((bill) => (
                <tr key={bill.reportItemId}>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(bill.reportItemId)}
                      onChange={() => toggle(bill.reportItemId)}
                      aria-label={`เลือกบิล ${bill.billNo}`}
                      className="h-4 w-4 accent-leaf"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{bill.billDate}</td>
                  <td className="whitespace-nowrap px-3 py-2">{bill.billNo}</td>
                  <td className="px-3 py-2">{bill.customerName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{number(bill.netWeight)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{number(bill.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && <div className="flex items-center gap-2 text-sm text-ink/60"><Loader2 className="animate-spin" size={16} /> กำลังคำนวณ preview...</div>}
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}

        {preview && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">จำนวนบิล</div><div className="font-bold">{preview.itemCount}</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักสุทธิรวม</div><div className="font-bold">{number(preview.originalWeightTotal)} กก.</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดจ่ายจริงรวม</div><div className="font-bold">฿{number(preview.paidTotal)}</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ต้นทุนซื้อเฉลี่ย</div><div className="font-bold">฿{number(preview.averagePrice)}/กก.</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุเฉลี่ยถ่วงน้ำหนัก</div><div className="font-bold tabular-nums">{formatRubberAge(preview.averageAgeHours)}</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุมากที่สุด</div><div className="font-bold tabular-nums">{formatRubberAge(preview.oldestAgeHours)}</div></div>
            </div>
            {preview.estimatedAgeItemCount > 0 && (
              <p className="text-pretty text-xs font-semibold text-amber-800">
                มีอายุประมาณการ {preview.estimatedAgeItemCount.toLocaleString("th-TH")} บิล
              </p>
            )}
          </>
        )}

        <div className="modal-actions flex justify-end gap-2">
          <button type="button" onClick={onClose} className="focus-ring rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white hover:bg-actionSecondary/90">ยกเลิก</button>
          <button
            type="button"
            disabled={!preview || loading || creating}
            onClick={() => {
              if (selectedIds.length === 0) return;
              setCreating(true);
              void onCreate(selectedIds)
                .catch((caught) => {
                  setError(caught instanceof Error ? caught.message : "สร้างรายการส่งออกไม่สำเร็จ");
                })
                .finally(() => setCreating(false));
            }}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-leaf px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {creating && <Loader2 size={16} className="animate-spin" />}
            ยืนยันสร้างฉบับร่าง
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
