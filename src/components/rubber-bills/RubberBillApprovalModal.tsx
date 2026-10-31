import { Check, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { ModalShell } from "@/components/shared/ModalShell";
import { RubberApprovalPolicyPanel } from "@/components/rubber-bills/RubberApprovalPolicyPanel";
import { useLocations } from "@/hooks/useLocations";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import { useRubberBillList, useRubberBillWorkCounts } from "@/hooks/useRubberBillList";
import type {
  RubberBillApprovalReason,
  Profile,
  RubberBill,
} from "@/types";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { formatNumber } from "@/lib/format";
import { rubberOwnerWork } from "@/lib/rubber-bills/central-sync";

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

export function RubberBillApprovalModal({
  locationId,
  profile,
  onClose,
}: {
  locationId: string;
  profile: Profile;
  onClose: () => void;
}) {
  const isOnline = useOnlineStatus();
  const [locationFilter, setLocationFilter] = useState(locationId);
  const {
    locations,
    isLoading: locationsLoading,
    error: locationsError,
  } = useLocations();
  const {
    settings,
    isLoading: settingsLoading,
    isFetching: settingsFetching,
    error: settingsError,
    saveGlobalDateRule,
    approveRequest,
    deleteRequest,
  } = useRubberBillApprovals({
    locationId: locationFilter,
    ownerUserId: profile.id,
  });
  const queue = useRubberBillList({
    ownerUserId: profile.id,
    locationId: locationFilter,
    mode: "pending_approval",
    documentStatus: "any",
    search: "",
  });
  const counts = useRubberBillWorkCounts(profile.id, locationFilter);
  const [nonCurrentDateRequiresApproval, setNonCurrentDateRequiresApproval] = useState(false);
  const [page, setPage] = useState(1);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "approve" | "delete"; bill: RubberBill } | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const settingsSaveRef = useRef(false);
  const requestLocksRef = useRef(new Set<string>());
  const serverDateRule = settings?.nonCurrentDateRequiresApproval;

  useEffect(() => {
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        const events = await rubberOwnerWork(profile.id);
        if (!active) return;
        const pending = new Set<string>(requestLocksRef.current);
        for (const event of events) {
          if (event.locationId === locationFilter && event.payload.queueAction
              && event.status === "pending") pending.add(event.payload.targetRequestId);
        }
        setBusyIds(pending);
      } catch { /* Preserve pending controls until queue status can be read. */ }
      finally { reading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [profile.id, locationFilter]);

  useEffect(() => {
    if (serverDateRule === undefined) return;
    setNonCurrentDateRequiresApproval(serverDateRule);
  }, [serverDateRule]);

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
  const canEditDateRule = profile.role === "super_admin";
  const settingsReady = isOnline && settings != null
    && !settingsLoading
    && !settingsFetching
    && !settingsError;
  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!canEditDateRule || !settingsReady || settingsSaveRef.current
        || nonCurrentDateRequiresApproval === settings?.nonCurrentDateRequiresApproval) return;
    settingsSaveRef.current = true;
    setSettingsSaveError(null);
    try {
      setIsSaving(true);
      await saveGlobalDateRule(nonCurrentDateRequiresApproval);
      toast.success("บันทึกกฎวันที่แล้ว");
    } catch (error) {
      const message = error instanceof Error ? error.message : "บันทึกกฎวันที่ไม่สำเร็จ";
      setSettingsSaveError(message);
      toast.error(message);
    } finally {
      settingsSaveRef.current = false;
      setIsSaving(false);
    }
  }

  async function handleApprove(request: RubberBill) {
    if (!request.approvalRequestId || busyIds.has(request.approvalRequestId) || requestLocksRef.current.has(request.approvalRequestId)) return;
    requestLocksRef.current.add(request.approvalRequestId);
    const errorKey = `${profile.id}:${request.locationId}:${request.approvalRequestId}`;
    setActionErrors(previous => ({ ...previous, [errorKey]: undefined }));
    try {
      setBusyIds(previous => new Set(previous).add(request.approvalRequestId!));
      await approveRequest(request.approvalRequestId, request.locationId);
      toast.message("ส่งคำสั่งอนุมัติแล้ว รอยืนยันผล");
    } catch (error) {
      setBusyIds(previous => { const next = new Set(previous); next.delete(request.approvalRequestId!); return next; });
      const message = error instanceof Error ? error.message : "อนุมัติคำขอไม่สำเร็จ";
      setActionErrors(previous => ({ ...previous, [errorKey]: message }));
      toast.error(message);
    } finally {
      requestLocksRef.current.delete(request.approvalRequestId);
    }
  }

  async function handleDelete(request: RubberBill) {
    if (!request.approvalRequestId || busyIds.has(request.approvalRequestId) || requestLocksRef.current.has(request.approvalRequestId)) return;
    requestLocksRef.current.add(request.approvalRequestId);
    const errorKey = `${profile.id}:${request.locationId}:${request.approvalRequestId}`;
    setActionErrors(previous => ({ ...previous, [errorKey]: undefined }));
    try {
      setBusyIds(previous => new Set(previous).add(request.approvalRequestId!));
      await deleteRequest(request.approvalRequestId, request.locationId);
      toast.message("ส่งคำสั่งลบแล้ว รอยืนยันผล");
    } catch (error) {
      setBusyIds(previous => { const next = new Set(previous); next.delete(request.approvalRequestId!); return next; });
      const message = error instanceof Error ? error.message : "ลบคำขอไม่สำเร็จ";
      setActionErrors(previous => ({ ...previous, [errorKey]: message }));
      toast.error(message);
    } finally {
      requestLocksRef.current.delete(request.approvalRequestId);
    }
  }

  const dateRule = (
    <form onSubmit={handleSaveSettings} aria-busy={isSaving}>
      <h5 className="text-balance text-sm font-semibold text-ink">กฎวันที่บิล</h5>
      <p className="mt-1 text-pretty text-xs text-ink/60">ใช้กับทุกสาขา รวมสาขานอกกลุ่ม โดยอิงวันที่ประเทศไทย</p>
      {(settingsLoading || settingsFetching) && <p role="status" className="mt-2 text-pretty text-sm text-ink/60">กำลังโหลดกฎวันที่...</p>}
      {settingsError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-3 text-pretty text-sm text-rose-700">{settingsError instanceof Error ? settingsError.message : "โหลดกฎวันที่ไม่สำเร็จ"}</p>}
      {!isOnline && <p role="status" className="mt-2 text-pretty text-sm text-amber-800">เชื่อมต่ออินเทอร์เน็ตเพื่อแก้ไขกฎวันที่</p>}
      <label className="mt-3 flex items-start gap-3 rounded-lg bg-field/55 p-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={nonCurrentDateRequiresApproval}
          disabled={!canEditDateRule || !settingsReady || isSaving}
          onChange={(event) => { setNonCurrentDateRequiresApproval(event.target.checked); setSettingsSaveError(null); }}
          className="focus-ring mt-0.5 size-5 shrink-0 accent-river disabled:cursor-not-allowed"
        />
        <span className="text-pretty font-semibold">ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน</span>
      </label>
      {settingsSaveError && <p role="alert" className="mt-2 text-pretty text-sm text-rose-700">{settingsSaveError}</p>}
      {canEditDateRule ? (
        <button type="submit" disabled={!settingsReady || isSaving || nonCurrentDateRequiresApproval === settings?.nonCurrentDateRequiresApproval} className="focus-ring mt-3 min-h-11 w-full rounded-lg bg-commit px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? "กำลังบันทึกกฎวันที่..." : "บันทึกกฎวันที่"}</button>
      ) : <p className="mt-2 text-pretty text-xs text-ink/60">เฉพาะ Super Admin เท่านั้นที่เปลี่ยนกฎวันที่บิลได้</p>}
    </form>
  );

  return (
    <ModalShell
      title="ตั้งค่าและอนุมัติบิลยาง"
      subtitle={`รออนุมัติ ${counts.data?.pendingApproval ?? 0} รายการ`}
      onClose={onClose}
      closeDisabled={isSaving}
      size="wide"
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-black/10 bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-balance font-bold text-ink">งานรออนุมัติบิลยาง</h3>
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-sm font-semibold">
                สาขา
                <select
                  aria-label="สาขา"
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="focus-ring h-11 max-w-full rounded-lg border border-black/15 bg-white px-3"
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            {!isOnline ? (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-4 text-center text-pretty text-sm text-amber-800">
                งานอนุมัติบิลยางใช้ได้เมื่อออนไลน์เท่านั้น
              </p>
            ) : locationsError || queue.error || counts.error ? (
              <p role="alert" className="rounded-md bg-rose-50 px-3 py-4 text-center text-pretty text-sm text-rose-700">
                {(locationsError ?? queue.error ?? counts.error) instanceof Error
                  ? (locationsError ?? queue.error ?? counts.error as Error).message
                  : "โหลดคำขอไม่สำเร็จ"}
              </p>
            ) : locationsLoading || queue.isLoading || counts.isLoading ? (
              <div className="space-y-2" role="status" aria-label="กำลังโหลดงานรออนุมัติ">
                {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-md bg-field" />)}
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-pretty text-sm text-ink/50">ไม่มีงานรออนุมัติในสาขานี้</p>
                {locations.length > 1 && <p className="mt-1 text-pretty text-xs text-ink/45">เลือกสาขาอื่นเพื่อตรวจคิวถัดไป</p>}
              </div>
            ) : visibleRequests.map((request) => {
              const summary = request.approvalProposedSummary ?? {
                customerName: request.customerName,
                billDate: request.billDate,
                billType: request.billType,
                netWeight: request.netWeight,
                averagePrice: request.price,
                netRubberValue: request.rubberValue,
                deductionTotal: request.deductionTotal,
                netTotal: request.netTotal,
              };
              return (
                <article key={request.id} className="rounded-lg border border-black/10 bg-field/20 p-4 text-sm">
                  {actionErrors[`${profile.id}:${request.locationId}:${request.approvalRequestId}`] && (
                    <p role="alert" className="mb-2 text-pretty text-sm text-danger">
                      {actionErrors[`${profile.id}:${request.locationId}:${request.approvalRequestId}`]}
                    </p>
                  )}
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="flex shrink-0 gap-2 whitespace-nowrap lg:order-last">
                      <button
                        type="button"
                        disabled={busyIds.has(request.approvalRequestId ?? "")}
                        onClick={() => setConfirmation({ kind: "approve", bill: request })}
                        className="focus-ring inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-success px-3 font-bold text-white disabled:opacity-50"
                        title="อนุมัติ"
                        aria-label={busyIds.has(request.approvalRequestId ?? "") ? "รอผลคำสั่ง" : "อนุมัติ"}
                        aria-busy={busyIds.has(request.approvalRequestId ?? "")}
                      >
                        {busyIds.has(request.approvalRequestId ?? "") ? "รอผล" : <><Check size={17} aria-hidden="true" /> อนุมัติ</>}
                      </button>
                      <button
                        type="button"
                        disabled={busyIds.has(request.approvalRequestId ?? "")}
                        onClick={() => setConfirmation({ kind: "delete", bill: request })}
                        className="focus-ring inline-flex h-11 items-center gap-1.5 rounded-lg bg-rose-600 px-3 font-bold text-white disabled:opacity-50"
                        title="ลบคำขอถาวร"
                        aria-label={busyIds.has(request.approvalRequestId ?? "") ? "รอผลคำสั่ง" : "ลบคำขอถาวร"}
                        aria-busy={busyIds.has(request.approvalRequestId ?? "")}
                      >
                        <Trash2 size={16} />
                        {busyIds.has(request.approvalRequestId ?? "") ? "รอผล" : "ลบ"}
                      </button>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
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
                        {locationNames.get(request.locationId) ?? "ไม่ทราบสาขา"} · {request.approvalRequestedByName ?? request.createdByName}
                      </p>
                      <p className="text-ink/55">{formatBangkokDateTime(request.operationalSortAt ?? request.clientCreatedAt)}</p>
                      <p className="text-pretty font-semibold text-ink">{summary.customerName || "ไม่ระบุลูกค้า"}</p>
                      <p className="text-pretty text-xs text-ink/60">{summary.billDate} · ประเภทบิล: {summary.billType || "ไม่ระบุ"}</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-black/10 pt-3 sm:grid-cols-3">
                        {[
                          ["น้ำหนักสุทธิ", `${formatNumber(summary.netWeight)} กก.`],
                          ["ราคาเฉลี่ย", `${formatNumber(summary.averagePrice)} บาท`],
                          ["มูลค่ายาง", `${formatNumber(summary.netRubberValue)} บาท`],
                          ["ยอดหัก", `${formatNumber(summary.deductionTotal)} บาท`],
                          ["ยอดสุทธิ", `${formatNumber(summary.netTotal)} บาท`],
                        ].map(([label, value]) => <div key={label}><dt className="text-xs text-ink/60">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums text-ink">{value}</dd></div>)}
                      </dl>
                    </div>
                  </div>
                </article>
              );
            })}
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

        <RubberApprovalPolicyPanel
          locations={locations}
          locationsLoading={locationsLoading}
          locationsError={locationsError instanceof Error ? locationsError : null}
          dateRule={dateRule}
        />

      </div>
      <AlertDialog
        open={confirmation !== null}
        title={confirmation?.kind === "delete" ? "ลบคำขอถาวร?" : "อนุมัติคำขอนี้?"}
        description={confirmation?.kind === "delete" ? "คำขอจะถูกลบถาวรและกู้คืนไม่ได้ แต่บิลจริงจะไม่ถูกสร้างหรือแก้ไข" : "ระบบจะตรวจ revision และ relation lock ล่าสุดก่อนบันทึก"}
        confirmLabel={confirmation?.kind === "delete" ? "ยืนยันลบคำขอ" : "ยืนยันอนุมัติ"}
        busy={false}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (!confirmation) return;
          const action = confirmation.kind === "delete" ? handleDelete : handleApprove;
          setConfirmation(null);
          void action(confirmation.bill);
        }}
      />
    </ModalShell>
  );
}
