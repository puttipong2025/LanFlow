import { Check, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { ModalShell } from "@/components/shared/ModalShell";
import { useLocations } from "@/hooks/useLocations";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import { useRubberBillList, useRubberBillWorkCounts } from "@/hooks/useRubberBillList";
import type {
  RubberBillApprovalReason,
  Profile,
  RubberBill,
} from "@/types";
import { formatBangkokDateTime } from "@/lib/bangkok-date";

const operationLabels = {
  create: "สร้างบิล",
  update: "แก้ไขบิล",
  delete: "ลบบิล",
};

const reasonLabels: Record<RubberBillApprovalReason, string> = {
  price: "ราคาเกินเพดาน",
  time: "พ้นเวลาที่กำหนด",
  non_current_date: "วันที่ไม่ใช่วันปัจจุบัน",
};

function formatDateTime(value: string) {
  return formatBangkokDateTime(value);
}

export function RubberBillApprovalModal({
  locationId,
  profile,
  onClose,
}: {
  locationId: string;
  profile: Profile;
  onClose: () => void;
}) {
  const [locationFilter, setLocationFilter] = useState(locationId);
  const {
    settings,
    isLoading,
    error,
    saveSettings,
    approveRequest,
    deleteRequest,
  } = useRubberBillApprovals({
    locationId: locationFilter,
  });
  const queue = useRubberBillList({
    ownerUserId: profile.id,
    locationId: locationFilter,
    mode: "pending_approval",
    documentStatus: "any",
    search: "",
  });
  const counts = useRubberBillWorkCounts(profile.id, locationFilter);
  const { locations } = useLocations();
  const [minutes, setMinutes] = useState("30");
  const [price, setPrice] = useState("");
  const [nonCurrentDateRequiresApproval, setNonCurrentDateRequiresApproval] = useState(false);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "approve" | "delete"; bill: RubberBill } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setMinutes(String(settings.editWindowMinutes));
    setPrice(settings.configuredPrice == null ? "" : String(settings.configuredPrice));
    setNonCurrentDateRequiresApproval(settings.nonCurrentDateRequiresApproval);
  }, [settings]);

  useEffect(() => {
    setLocationFilter(locationId);
  }, [locationId]);

  useEffect(() => {
    setPage(1);
  }, [locationFilter]);

  const totalPages = Math.max(1, Math.ceil(queue.bills.length / 10));
  const currentPage = Math.min(page, totalPages);
  const visibleRequests = queue.bills.slice((currentPage - 1) * 10, currentPage * 10);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const locationNames = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations]
  );
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
      (!/^\d+(\.\d{1,2})?$/.test(normalizedPrice) || parsedPrice < 0)
    ) {
      toast.error("ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง");
      return;
    }

    try {
      setIsSaving(true);
      await saveSettings({
        editWindowMinutes: parsedMinutes,
        configuredPrice: parsedPrice,
        nonCurrentDateRequiresApproval,
      });
      toast.success("บันทึกการตั้งค่าแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApprove(request: RubberBill) {
    if (!request.approvalRequestId) return;
    try {
      setBusyId(request.approvalRequestId);
      await approveRequest(request.approvalRequestId);
      toast.success("อนุมัติคำขอแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อนุมัติคำขอไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(request: RubberBill) {
    if (!request.approvalRequestId) return;
    try {
      setBusyId(request.approvalRequestId);
      await deleteRequest(request.approvalRequestId);
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
      subtitle={`รออนุมัติ ${counts.data?.pendingApproval ?? 0} รายการ`}
      onClose={onClose}
      size="wide"
    >
      <div className="space-y-5">
        <form onSubmit={handleSaveSettings} className="rounded-md border border-black/10 p-4">
            <h3 className="text-balance font-bold text-ink">เกณฑ์อนุมัติ</h3>
            <p className="mb-3 text-pretty text-sm text-ink/60">
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
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-commit px-4 font-bold text-white hover:bg-commit/90 disabled:opacity-50"
            >
              <Check size={18} />
              บันทึก
            </button>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-md bg-field/55 p-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={nonCurrentDateRequiresApproval}
              onChange={(event) => setNonCurrentDateRequiresApproval(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-river"
            />
            <span>
              <strong className="block">ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน</strong>
              <span className="text-ink/60">ตรวจทั้งวันย้อนหลังและวันล่วงหน้าตามเวลาไทย</span>
            </span>
          </label>
        </form>

        <section className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-balance font-bold text-ink">งานรออนุมัติบิลยาง</h3>
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-sm font-semibold">
                สาขา
                <select
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            {error || queue.error || counts.error ? (
              <p role="alert" className="rounded-md bg-rose-50 px-3 py-4 text-center text-pretty text-sm text-rose-700">
                {(error ?? queue.error ?? counts.error) instanceof Error
                  ? (error ?? queue.error ?? counts.error as Error).message
                  : "โหลดคำขอไม่สำเร็จ"}
              </p>
            ) : isLoading || queue.isLoading || counts.isLoading ? (
              <div className="space-y-2" role="status" aria-label="กำลังโหลดงานรออนุมัติ">
                {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-md bg-field" />)}
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-pretty text-sm text-ink/50">ไม่มีงานรออนุมัติในสาขานี้</p>
                {locations.length > 1 && <p className="mt-1 text-pretty text-xs text-ink/45">เลือกสาขาอื่นเพื่อตรวจคิวถัดไป</p>}
              </div>
            ) : visibleRequests.map((request) => (
              <article key={request.id} className="rounded-md border border-black/10 p-3 text-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {operationLabels[request.approvalOperation ?? "update"]}
                      </span>
                      {(request.approvalReasons ?? []).map((reason: RubberBillApprovalReason) => (
                        <span key={reason} className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">
                          {reasonLabels[reason]}
                        </span>
                      ))}
                    </div>
                    <p className="font-semibold">
                      {locationNames.get(request.locationId) ?? "ไม่ทราบสาขา"} · {request.createdByName}
                    </p>
                    <p className="text-ink/55">{formatDateTime(request.operationalSortAt ?? request.clientCreatedAt)}</p>
                    <p className="text-pretty text-ink/70">
                      {request.customerName || "ไม่ระบุลูกค้า"} · {request.billDate} · ยอดสุทธิ: <span className="tabular-nums">{request.netTotal.toLocaleString("th-TH")}</span> บาท
                    </p>
                  </div>
                  <div className="flex gap-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busyId === request.approvalRequestId}
                        onClick={() => setConfirmation({ kind: "approve", bill: request })}
                        className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-success text-white disabled:opacity-50"
                        title="อนุมัติ"
                        aria-label="อนุมัติ"
                      >
                        <Check size={17} />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === request.approvalRequestId}
                        onClick={() => setConfirmation({ kind: "delete", bill: request })}
                        className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-rose-600 px-3 font-bold text-white disabled:opacity-50"
                        title="ลบคำขอถาวร"
                        aria-label="ลบคำขอถาวร"
                      >
                        <Trash2 size={16} />
                        ลบ
                      </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {queue.bills.length > 0 && (
            <nav aria-label="แบ่งหน้างานรออนุมัติ" className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold disabled:opacity-40">ก่อนหน้า</button>
              <span className="tabular-nums text-sm text-ink/60">หน้า {currentPage} / {totalPages}</span>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold disabled:opacity-40">ถัดไป</button>
              {queue.hasMore && currentPage === totalPages && (
                <button type="button" disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()} className="focus-ring h-10 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:opacity-50">{queue.isFetchingNextPage ? "กำลังโหลด..." : "โหลดงานถัดไป"}</button>
              )}
            </nav>
          )}
        </section>
      </div>
      <AlertDialog
        open={confirmation !== null}
        title={confirmation?.kind === "delete" ? "ลบคำขอถาวร?" : "อนุมัติคำขอนี้?"}
        description={confirmation?.kind === "delete" ? "คำขอจะถูกลบถาวรและกู้คืนไม่ได้ แต่บิลจริงจะไม่ถูกสร้างหรือแก้ไข" : "ระบบจะตรวจ revision และ relation lock ล่าสุดก่อนบันทึก"}
        confirmLabel={confirmation?.kind === "delete" ? "ยืนยันลบคำขอ" : "ยืนยันอนุมัติ"}
        busy={busyId !== null}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (!confirmation) return;
          const action = confirmation.kind === "delete" ? handleDelete : handleApprove;
          void action(confirmation.bill).finally(() => setConfirmation(null));
        }}
      />
    </ModalShell>
  );
}
