import { toast } from "sonner";
import { calculateWeightLossPercent } from "@/lib/rubber-exports/calculations";
import type { RubberExportDetails, RubberExportEditValues } from "@/types/rubber-exports";

type SaveApi = {
  update: (id: string, values: RubberExportEditValues) => Promise<{ refreshFailed: boolean } | void>;
  details: (id: string, signal?: AbortSignal) => Promise<RubberExportDetails>;
};

export async function saveRubberExportDetails(api: SaveApi, details: RubberExportDetails, values: RubberExportEditValues,
  onDetails: (details: RubberExportDetails) => void, signal?: AbortSignal) {
  if (signal?.aborted) return;
  try {
    const result = await api.update(details.id, values);
    if (signal?.aborted) return;
    let refreshFailed = result ? result.refreshFailed : false;
    if (values.adjustment && values.currentWeight !== null) {
      // Acknowledged weight writes remain committed even if subsequent reads fail.
      onDetails({ ...details, currentWeight: values.currentWeight,
        weightLossPercent: calculateWeightLossPercent(details.originalWeightTotal, values.currentWeight) });
    }
    try {
      const next = await api.details(details.id, signal);
      if (signal?.aborted) return;
      onDetails(next);
    } catch (error) {
      if (signal?.aborted) return;
      if (!values.adjustment) throw error; refreshFailed = true;
    }
    if (values.adjustment && refreshFailed) toast.warning("บันทึกน้ำหนักแล้ว แต่โหลดข้อมูลล่าสุดได้ไม่ครบ กรุณารีเฟรช");
    else toast.success(details.status === "draft" ? "บันทึกฉบับร่างแล้ว" : "บันทึกน้ำหนักแล้ว");
  } catch (error) {
    if (signal?.aborted) return;
    toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    throw error;
  }
}
