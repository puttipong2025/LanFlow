import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { ModalShell } from "@/components/shared/ModalShell";
import { useLocations } from "@/hooks/useLocations";
import { useRubberBillApprovals } from "@/hooks/useRubberBillApprovals";
import { useRubberApprovalGroups } from "@/hooks/useRubberApprovalGroups";
import { useRubberBillList, useRubberBillWorkCounts } from "@/hooks/useRubberBillList";
import type {
  RubberBillApprovalReason,
  Profile,
  RubberBill,
  RubberApprovalGroup,
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
    cachedLocationIds: locations.map((location) => location.id),
  });
  const queue = useRubberBillList({
    ownerUserId: profile.id,
    locationId: locationFilter,
    mode: "pending_approval",
    documentStatus: "any",
    search: "",
  });
  const counts = useRubberBillWorkCounts(profile.id, locationFilter);
  const groups = useRubberApprovalGroups(locations.map((location) => location.id));
  const [minutes, setMinutes] = useState("30");
  const [price, setPrice] = useState("");
  const [nonCurrentDateRequiresApproval, setNonCurrentDateRequiresApproval] = useState(false);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RubberApprovalGroup | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupLocationIds, setGroupLocationIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ kind: "approve" | "delete"; bill: RubberBill } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<RubberApprovalGroup | null>(null);

  useEffect(() => {
    if (!settings) return;
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
  const settingsReady = settings != null
    && !settingsLoading
    && !settingsFetching
    && !settingsError;
  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settingsReady) return;
    try {
      setIsSaving(true);
      await saveGlobalDateRule(nonCurrentDateRequiresApproval);
      toast.success("บันทึกกฎวันที่แล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกกฎวันที่ไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveGroup(event: React.FormEvent) {
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
      const input = {
        locationIds: groupLocationIds,
        editWindowMinutes: parsedMinutes,
        configuredPrice: parsedPrice,
      };
      if (editingGroup) {
        await groups.updateGroup({ id: editingGroup.id, ...input });
        toast.success("แก้ไขกลุ่มแล้ว");
      } else {
        await groups.createGroup(input);
        toast.success("สร้างกลุ่มแล้ว");
      }
      setEditingGroup(null);
      setGroupEditorOpen(false);
      setGroupLocationIds([]);
      setMinutes("30");
      setPrice("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  function openGroupEditor(group?: RubberApprovalGroup) {
    setEditingGroup(group ?? null);
    setGroupEditorOpen(true);
    setGroupLocationIds(group?.locationIds ?? []);
    setMinutes(String(group?.editWindowMinutes ?? 30));
    setPrice(group?.configuredPrice == null ? "" : String(group.configuredPrice));
  }

  function toggleGroupLocation(locationId: string) {
    setGroupLocationIds((current) => current.includes(locationId)
      ? current.filter((id) => id !== locationId)
      : [...current, locationId]);
  }

  const groupEditorLocationIds = editingGroup
    ? [...new Set([...groups.availableLocationIds, ...editingGroup.locationIds])]
    : groups.availableLocationIds;

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
        <section className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-balance font-bold text-ink">กลุ่มเกณฑ์ราคาและเวลา</h3>
              <p className="text-pretty text-sm text-ink/60">สาขานอกกลุ่มจะยกเว้นเฉพาะราคาและเวลา</p>
            </div>
            {!groupEditorOpen
              && !groups.isLoading
              && !locationsLoading
              && !groups.error
              && !locationsError
              && groups.availableLocationIds.length > 0 && (
              <button type="button" onClick={() => openGroupEditor()} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-commit px-3 text-sm font-bold text-white hover:bg-commit/90">
                <Plus size={16} /> สร้างกลุ่ม
              </button>
            )}
          </div>
          {groups.isLoading || locationsLoading ? (
            <p role="status" className="text-sm text-ink/60">กำลังโหลดกลุ่ม...</p>
          ) : groups.error || locationsError ? (
            <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
              {(groups.error ?? locationsError) instanceof Error
                ? (groups.error ?? locationsError as Error).message
                : "โหลดกลุ่มไม่สำเร็จ"}
            </p>
          ) : groupEditorOpen ? (
            <form onSubmit={handleSaveGroup} className="space-y-3 rounded-md bg-field/55 p-3">
              <h4 className="font-semibold text-ink">{editingGroup ? `แก้ไขกลุ่ม ${groups.groups.findIndex((group) => group.id === editingGroup.id) + 1}` : "สร้างกลุ่มใหม่"}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold">เวลาแก้ไขได้ (นาที)
                  <input aria-label="เวลาแก้ไขได้ (นาที)" type="number" min="0" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="focus-ring h-11 rounded-md border border-black/10 px-3" required />
                </label>
                <label className="grid gap-1 text-sm font-semibold">ราคายางที่กำหนด
                  <input aria-label="ราคายางที่กำหนด" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="เว้นว่าง = ไม่ตรวจราคา" className="focus-ring h-11 rounded-md border border-black/10 px-3" />
                </label>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">สาขาในกลุ่ม</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {groupEditorLocationIds.map((id) => {
                    const location = locations.find((item) => item.id === id);
                    if (!location) return null;
                    return <label key={id} className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm">
                      <input type="checkbox" checked={groupLocationIds.includes(id)} onChange={() => toggleGroupLocation(id)} />
                      {location.name}
                    </label>;
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={groups.isSaving || groupLocationIds.length === 0} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกกลุ่ม</button>
                <button type="button" onClick={() => { setEditingGroup(null); setGroupEditorOpen(false); setGroupLocationIds([]); }} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold">ยกเลิก</button>
              </div>
            </form>
          ) : groups.groups.length === 0 && groups.availableLocationIds.length === 0 ? (
            <p className="text-pretty text-sm text-ink/60">ยังไม่มีกลุ่ม และไม่มีสาขาให้เลือกเพิ่ม</p>
          ) : (
            <div className="space-y-2" data-testid="approval-group-list">
              {groups.availableLocationIds.length > 0 && (
                <div className="rounded-md border border-dashed border-black/15 bg-field/40 p-3">
                  <h4 className="text-balance font-semibold text-ink">ยังไม่จัดกลุ่ม</h4>
                  <p className="text-pretty text-sm text-ink/60">
                    {groups.availableLocationIds
                      .map((id) => locations.find((location) => location.id === id)?.name ?? id)
                      .join(", ")}
                  </p>
                  <p className="text-pretty text-sm text-ink/70">ยกเว้นเกณฑ์ราคาและเวลา</p>
                </div>
              )}
              {groups.groups.map((group, index) => <div key={group.id} className="flex flex-col gap-2 rounded-md border border-black/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="font-semibold text-ink">กลุ่ม {index + 1}</p><p className="text-pretty text-sm text-ink/60">{group.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ")}</p><p className="text-sm text-ink/70">เวลา {group.editWindowMinutes} นาที · ราคา {group.configuredPrice == null ? "ไม่ตรวจ" : `${group.configuredPrice.toFixed(2)} บาท`}</p></div>
                <div className="flex gap-2"><button type="button" onClick={() => openGroupEditor(group)} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-river/30 px-3 text-sm font-semibold text-river"><Pencil size={15} /> แก้ไข</button><button type="button" onClick={() => setGroupToDelete(group)} disabled={groups.isSaving} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-semibold text-white disabled:opacity-50"><Trash2 size={15} /> ลบ</button></div>
              </div>)}
            </div>
          )}
        </section>
        <form onSubmit={handleSaveSettings} className="rounded-md border border-black/10 p-4">
          <h3 className="text-balance font-bold text-ink">กฎวันที่บิล</h3>
          {(settingsLoading || settingsFetching) && (
            <p role="status" className="mt-2 text-pretty text-sm text-ink/60">กำลังโหลดกฎวันที่...</p>
          )}
          {settingsError && (
            <p role="alert" className="mt-2 rounded-md bg-rose-50 p-3 text-pretty text-sm text-rose-700">
              {settingsError instanceof Error ? settingsError.message : "โหลดกฎวันที่ไม่สำเร็จ"}
            </p>
          )}
          <label className="mt-3 flex items-start gap-3 rounded-md bg-field/55 p-3 text-sm text-ink"><input type="checkbox" checked={nonCurrentDateRequiresApproval} disabled={!settingsReady || isSaving} onChange={(event) => setNonCurrentDateRequiresApproval(event.target.checked)} className="mt-0.5 size-4 accent-river disabled:cursor-not-allowed" /><span><strong className="block">ขออนุมัติเมื่อวันที่บิลไม่ใช่วันปัจจุบัน</strong><span className="text-ink/60">ใช้กับทุกสาขา รวมสาขานอกกลุ่ม</span></span></label>
          <button type="submit" disabled={!settingsReady || isSaving} className="focus-ring mt-3 h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกกฎวันที่</button>
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
            {locationsError || queue.error || counts.error ? (
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
                    <p className="text-ink/55">{formatBangkokDateTime(request.operationalSortAt ?? request.clientCreatedAt)}</p>
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
      <AlertDialog
        open={groupToDelete !== null}
        title="ลบกลุ่มนี้?"
        description="สาขาในกลุ่มจะได้รับการยกเว้นราคาและเวลา แต่กฎวันที่ยังคงใช้"
        confirmLabel="ยืนยันลบกลุ่ม"
        busy={groups.isSaving}
        onCancel={() => setGroupToDelete(null)}
        onConfirm={() => {
          if (!groupToDelete) return;
          void groups.deleteGroup(groupToDelete.id)
            .then(() => toast.success("ลบกลุ่มแล้ว"))
            .catch((error) => toast.error(error instanceof Error ? error.message : "ลบกลุ่มไม่สำเร็จ"))
            .finally(() => setGroupToDelete(null));
        }}
      />
    </ModalShell>
  );
}
