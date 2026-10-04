import { RefreshCw } from "lucide-react";

import { ModalShell } from "@/components/shared/ModalShell";
import type { RubberBillOcrQueueItem } from "@/hooks/useRubberBillOcrQueue";

export function RubberBillOcrQueueModal({
  locationId,
  items,
  online,
  onClose,
  onRetry,
  onReview,
  onRemove,
}: {
  locationId: string;
  items: RubberBillOcrQueueItem[];
  online: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  onReview: (item: RubberBillOcrQueueItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ModalShell title="คิวอ่านใบชั่ง" subtitle="1 รูปต่อ 1 บิลยาง · คิวนี้หายเมื่อปิดหรือรีโหลดหน้า" onClose={onClose} closeOnEscape nativeModal>
      <ul className="divide-y divide-black/10" aria-label={`รายการ OCR สาขา ${locationId}`}>
        {items.map((item) => (
          <li key={item.id} className="flex gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={`ตัวอย่างรูปใบชั่ง ${item.file.name}`} className="size-16 rounded border border-black/10 object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{item.file.name}</p>
              <p role="status" className="text-sm text-ink/60">
                {item.status === "pending" ? "รอประมวลผล" : item.status === "processing" ? "กำลังอ่านข้อมูล" : item.status === "ready" ? "พร้อมตรวจและเพิ่มบิล" : item.status === "reviewing" ? "กำลังตรวจข้อมูลบิล" : item.errorMessage || "อ่านใบชั่งไม่สำเร็จ"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.status === "ready" && <button type="button" onClick={() => onReview(item)} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-semibold text-white hover:bg-commit/90">ตรวจและเพิ่มบิล</button>}
              {item.status === "error" && <button type="button" disabled={!online} title={!online ? "ลองใหม่ได้เมื่อออนไลน์" : "ลองอ่านรูปอีกครั้ง"} onClick={() => onRetry(item.id)} className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="ลองอ่านใบชั่งอีกครั้ง"><RefreshCw size={17} aria-hidden="true" /></button>}
              {item.status !== "processing" && <button type="button" onClick={() => onRemove(item.id)} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold text-ink hover:bg-field">เอาออก</button>}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="p-8 text-center text-sm text-ink/60">ไม่มีรายการในคิว</li>}
      </ul>
    </ModalShell>
  );
}
