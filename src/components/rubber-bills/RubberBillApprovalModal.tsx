import { Check, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { useLocations } from "@/hooks/useLocations";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import type {
  RubberBillApprovalOperation,
  RubberBillApprovalReason,
  RubberBillApprovalRequest,
  RubberBillApprovalStatus,
} from "@/types";

const operationLabels: Record<RubberBillApprovalOperation, string> = {
  create: "สร้างบิล",
  update: "แก้ไขบิล",
  delete: "ลบบิล",
};

const reasonLabels: Record<RubberBillApprovalReason, string> = {
  price: "ราคาไม่ตรง",
  time: "พ้นเวลาที่กำหนด",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function payloadSummary(payload: Record<string, unknown> | null) {
  if (!payload) return "—";
  const items = Array.isArray(payload.items) ? payload.items : [];
  const prices = items
    .filter((item): item is Record<string, unknown> => (
      typeof item === "object" && item !== null && item.itemType === "weigh"
    ))
    .map((item) => Number(item.unitPrice))
    .filter(Number.isFinite);

  return [
    `ลูกค้า: ${String(payload.customerName ?? "—")}`,
    `วันที่: ${String(payload.billDate ?? "—")}`,
    `ราคาแต่ละส่วน: ${prices.length ? prices.join(", ") : "—"}`,
    `ยอดสุทธิ: ${Number(payload.netTotal ?? 0).toLocaleString("th-TH")}`,
  ].join(" · ");
}

export function RubberBillApprovalModal({
  locationId,
  onClose,
}: {
  locationId: string;
  onClose: () => void;
}) {
  const {
    settings,
    requests,
    isLoading,
    error,
    saveSettings,
    approveRequest,
    deleteRequest,
  } = useRubberBillApprovals({ locationId, includeRequests: true });
  const { locations } = useLocations();
  const [minutes, setMinutes] = useState("30");
  const [price, setPrice] = useState("");
  const [statusFilter, setStatusFilter] = useState<RubberBillApprovalStatus>("pending");
  const [locationFilter, setLocationFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMinutes(String(settings.editWindowMinutes));
    setPrice(settings.configuredPrice == null ? "" : String(settings.configuredPrice));
  }, [settings]);

  const locationNames = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations]
  );
  const visibleRequests = requests.filter((request) => (
    request.requestStatus === statusFilter &&
    (locationFilter === "all" || request.locationId === locationFilter)
  ));

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    const parsedMinutes = Number(minutes);
    const normalizedPrice = price.trim();
    const parsedPrice = normalizedPrice ? Number(normalizedPrice) : null;

    if (!Number.isInteger(parsedMinutes) || parsedMinutes < 0) {
      toast.error("จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }
    if (
      parsedPrice !== null &&
      (!/^\d+(\.\d{1,2})?$/.test(normalizedPrice) || parsedPrice <= 0)
    ) {
      toast.error("ราคายางต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
      return;
    }

    try {
      setIsSaving(true);
      await saveSettings({
        editWindowMinutes: parsedMinutes,
        configuredPrice: parsedPrice,
      });
      toast.success("บันทึกการตั้งค่าแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApprove(request: RubberBillApprovalRequest) {
    if (!window.confirm(`อนุมัติคำขอ${operationLabels[request.operation]}นี้ใช่ไหม?`)) return;
    try {
      setBusyId(request.id);
      await approveRequest(request.id);
      toast.success("อนุมัติคำขอแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อนุมัติคำขอไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(request: RubberBillApprovalRequest) {
    if (!window.confirm("ลบคำขอนี้ถาวรใช่ไหม? รายการจะกู้คืนไม่ได้")) return;
    try {
      setBusyId(request.id);
      await deleteRequest(request.id);
      toast.success("ลบคำขอถาวรแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ลบคำขอไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell
      title="ตั้งค่าและอนุมัติบิลยาง"
      subtitle={`รออนุมัติ ${requests.filter((request) => request.requestStatus === "pending").length} รายการ`}
      onClose={onClose}
      size="wide"
    >
      <div className="space-y-5">
        <form onSubmit={handleSaveSettings} className="rounded-md border border-black/10 p-4">
          <h3 className="font-bold text-ink">เกณฑ์อนุมัติ</h3>
          <p className="mb-3 text-sm text-ink/60">
            ตั้งราคาเป็นค่าว่างเพื่อปิดการตรวจราคา ส่วนเวลา 0 นาทีหมายถึงแก้ไขครั้งถัดไปต้องขออนุมัติทันที
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-sm font-semibold">
              เวลาแก้ไขได้ (นาที)
              <input
                type="number"
                min="0"
                step="1"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                className="focus-ring h-11 rounded-md border border-black/10 px-3"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              ราคายางที่กำหนด
              <input
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="เว้นว่าง = ไม่ตรวจราคา"
                className="focus-ring h-11 rounded-md border border-black/10 px-3"
              />
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 font-bold text-white disabled:opacity-50"
            >
              <Check size={18} />
              บันทึก
            </button>
          </div>
        </form>

        <section className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h3 className="font-bold text-ink">คำขอบิลยาง</h3>
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-sm font-semibold">
                สาขา
                <select
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
                >
                  <option value="all">ทุกสาขา</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                สถานะ
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as RubberBillApprovalStatus)}
                  className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
                >
                  <option value="pending">รออนุมัติ</option>
                  <option value="approved">อนุมัติแล้ว</option>
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            {error ? (
              <p className="rounded-md bg-rose-50 px-3 py-4 text-center text-sm text-rose-700">
                {error instanceof Error ? error.message : "โหลดคำขอไม่สำเร็จ"}
              </p>
            ) : isLoading ? (
              <p className="py-6 text-center text-sm text-ink/50">กำลังโหลด...</p>
            ) : visibleRequests.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink/50">ไม่มีคำขอในสถานะนี้</p>
            ) : visibleRequests.map((request) => (
              <article key={request.id} className="rounded-md border border-black/10 p-3 text-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {operationLabels[request.operation]}
                      </span>
                      {request.matchedReasons.map((reason) => (
                        <span key={reason} className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">
                          {reasonLabels[reason]}
                        </span>
                      ))}
                    </div>
                    <p className="font-semibold">
                      {locationNames.get(request.locationId) ?? "ไม่ทราบสาขา"} · {request.requestedByName}
                    </p>
                    <p className="text-ink/55">{formatDateTime(request.requestedAt)}</p>
                    <p className="text-ink/70">
                      ราคาที่ใช้ตรวจ: {request.configuredPriceSnapshot == null ? "ไม่ได้ตั้ง" : request.configuredPriceSnapshot}
                    </p>
                  </div>
                  {request.requestStatus === "pending" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === request.id}
                        onClick={() => void handleApprove(request)}
                        className="focus-ring flex h-9 items-center gap-2 rounded-md bg-leaf px-3 font-bold text-white disabled:opacity-50"
                      >
                        <Check size={16} />
                        อนุมัติ
                      </button>
                      <button
                        type="button"
                        disabled={busyId === request.id}
                        onClick={() => void handleDelete(request)}
                        className="focus-ring flex h-9 items-center gap-2 rounded-md bg-rose-600 px-3 font-bold text-white disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                        ลบถาวร
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  <div className="rounded bg-field/60 p-2">
                    <p className="mb-1 font-bold">ก่อนแก้ไข</p>
                    <p className="text-ink/65">{payloadSummary(request.originalPayload)}</p>
                  </div>
                  <div className="rounded bg-field/60 p-2">
                    <p className="mb-1 font-bold">หลังแก้ไข / รายการที่ขอสร้าง</p>
                    <p className="text-ink/65">{payloadSummary(request.proposedPayload)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
