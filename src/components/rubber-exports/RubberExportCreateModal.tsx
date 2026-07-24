"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import type {
  RubberExportCutoffOption,
  RubberExportPreview,
} from "@/types/rubber-exports";

function number(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RubberExportCreateModal({
  options,
  onPreview,
  onCreate,
  onClose,
}: {
  options: RubberExportCutoffOption[];
  onPreview: (reportItemId: string) => Promise<RubberExportPreview>;
  onCreate: (reportItemId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<RubberExportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequest = useRef(0);

  async function select(reportItemId: string) {
    const request = ++previewRequest.current;
    setSelectedId(reportItemId);
    setPreview(null);
    setError(null);
    if (!reportItemId) return;
    setLoading(true);
    try {
      const nextPreview = await onPreview(reportItemId);
      if (request === previewRequest.current) setPreview(nextPreview);
    } catch (caught) {
      if (request === previewRequest.current) {
        setError(caught instanceof Error ? caught.message : "โหลด preview ไม่สำเร็จ");
      }
    } finally {
      if (request === previewRequest.current) setLoading(false);
    }
  }

  return (
    <ModalShell title="สร้างรายการส่งออกยาง" subtitle="เลือกบิล cutoff หนึ่งใบ" onClose={onClose} size="wide">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">บิล cutoff</span>
          <select
            value={selectedId}
            onChange={(event) => void select(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
          >
            <option value="">เลือกบิล</option>
            {options.map((option) => (
              <option key={option.reportItemId} value={option.reportItemId}>
                {option.billNo} · {option.customerName} · {new Date(option.eligibilityAt).toLocaleString("th-TH")}
              </option>
            ))}
          </select>
        </label>

        {loading && <div className="flex items-center gap-2 text-sm text-ink/60"><Loader2 className="animate-spin" size={16} /> กำลังคำนวณ preview...</div>}
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}

        {preview && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">จำนวนบิล</div><div className="font-bold">{preview.itemCount}</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักสุทธิหลังหักรวม</div><div className="font-bold">{number(preview.originalWeightTotal)} กก.</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดจ่ายจริงรวม</div><div className="font-bold">฿{number(preview.paidTotal)}</div></div>
              <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ราคาเฉลี่ย</div><div className="font-bold">฿{number(preview.averagePrice)}/กก.</div></div>
            </div>
            <div className="overflow-x-auto rounded-md border border-black/10">
              <table className="min-w-full text-sm">
                <thead className="bg-mint/50">
                  <tr><th className="px-3 py-2 text-left">บิล</th><th className="px-3 py-2 text-left">ลูกค้า</th><th className="px-3 py-2 text-right">น้ำหนัก</th><th className="px-3 py-2 text-right">จ่ายจริง</th></tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {preview.items.map((item) => (
                    <tr key={item.billId}>
                      <td className="px-3 py-2">{item.billNo}</td>
                      <td className="px-3 py-2">{item.customerName}</td>
                      <td className="px-3 py-2 text-right">{number(item.netWeight)}</td>
                      <td className="px-3 py-2 text-right">{number(item.paidAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="focus-ring rounded-md bg-field px-4 py-2 font-semibold">ยกเลิก</button>
          <button
            type="button"
            disabled={!preview || creating}
            onClick={() => {
              if (!selectedId) return;
              setCreating(true);
              void onCreate(selectedId).finally(() => setCreating(false));
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
