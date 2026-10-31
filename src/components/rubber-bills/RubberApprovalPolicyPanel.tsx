"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  RubberAutoResetLockControl,
  RubberAutoResetToggleControl,
} from "@/components/rubber-bills/RubberAutoResetLockControl";
import { RubberApprovalGroupBranchPicker } from "@/components/rubber-bills/RubberApprovalGroupBranchPicker";
import { RubberApprovalSystemSettings } from "@/components/rubber-bills/RubberApprovalSystemSettings";
import { AlertDialog } from "@/components/shared/AlertDialog";
import {
  RubberMaxPriceAllowanceError,
  type RubberPriceAllowanceAutoResetLockInput,
  useRubberApprovalGroups,
} from "@/hooks/useRubberApprovalGroups";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import type { Location, RubberApprovalGroup } from "@/types";

type AutoResetLockTarget =
  | { scope: "group"; groupId: string; label: string; expectedLocked: boolean }
  | { scope: "ungrouped"; label: string; expectedLocked: boolean };

type PendingConfirmation =
  | { kind: "central"; value: number; previousValue: number; expectedRevision: number }
  | { kind: "maxPriceAllowance"; value: number; previousValue: number }
  | { kind: "autoResetEnable"; expectedEnabled: boolean }
  | { kind: "autoResetUnlock"; target: AutoResetLockTarget }
  | { kind: "delete"; group: RubberApprovalGroup };

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

function parseMoney(value: string, label: string, allowBlank = false) {
  const normalized = value.trim();
  if (allowBlank && normalized === "") return 0;
  if (!MONEY_PATTERN.test(normalized)) throw new Error(`${label}ต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
  return Number(normalized);
}

function isSameMoney(value: string, current: number) {
  const normalized = value.trim();
  return MONEY_PATTERN.test(normalized) && Number(normalized) === current;
}

function actorText(name: string, updatedAt: string) {
  return `แก้ไขล่าสุดโดย ${name || "ไม่ทราบชื่อ"} · ${formatBangkokDateTime(updatedAt)}`;
}

function lockInput(target: AutoResetLockTarget, locked: boolean): RubberPriceAllowanceAutoResetLockInput {
  return target.scope === "group"
    ? { scope: "group", groupId: target.groupId, locked, expectedLocked: target.expectedLocked }
    : { scope: "ungrouped", locked, expectedLocked: target.expectedLocked };
}

export function RubberApprovalPolicyPanel({
  locations,
  locationsLoading,
  locationsError,
  dateRule,
}: {
  locations: Location[];
  locationsLoading: boolean;
  locationsError: Error | null;
  dateRule: ReactNode;
}) {
  const policy = useRubberApprovalGroups();
  const isOnline = useOnlineStatus();
  const [centralPrice, setCentralPrice] = useState("");
  const [maxPriceAllowance, setMaxPriceAllowance] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<RubberApprovalGroup | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [minutes, setMinutes] = useState("30");
  const [allowance, setAllowance] = useState("");
  const [groupRevisionSnapshot, setGroupRevisionSnapshot] = useState<Record<string, number>>({});
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [ungroupedEditorOpen, setUngroupedEditorOpen] = useState(false);
  const [ungroupedMinutes, setUngroupedMinutes] = useState<string | null>(null);
  const [ungroupedAllowance, setUngroupedAllowance] = useState<string | null>(null);
  const [ungroupedRevisionSnapshot, setUngroupedRevisionSnapshot] = useState<number | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [ungroupedError, setUngroupedError] = useState<string | null>(null);
  const [maxPriceAllowanceError, setMaxPriceAllowanceError] = useState<string | null>(null);
  const [autoResetError, setAutoResetError] = useState<string | null>(null);
  const [autoResetLockError, setAutoResetLockError] = useState<{ target: AutoResetLockTarget; message: string } | null>(null);
  const [isMutatingPolicy, setIsMutatingPolicy] = useState(false);
  const ungroupedEditButtonRef = useRef<HTMLButtonElement>(null);
  const mutationBusyRef = useRef(false);

  async function runPolicyMutation(action: () => Promise<void>) {
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setIsMutatingPolicy(true);
    try { await action(); }
    finally { mutationBusyRef.current = false; setIsMutatingPolicy(false); }
  }

  const central = policy.centralPrice;
  const ungrouped = policy.ungroupedDefaults;
  const maximum = policy.maxPriceAllowance;
  const loading = policy.isLoading || locationsLoading;
  const error = policy.error ?? locationsError;
  const isBusy = isMutatingPolicy || policy.isSaving;

  function openGroupEditor(group?: RubberApprovalGroup) {
    setEditingGroup(group ?? null);
    setGroupEditorOpen(true);
    setLocationIds(group?.locationIds ?? []);
    setMinutes(String(group?.editWindowMinutes ?? 30));
    setAllowance(group?.priceAllowance ? String(group.priceAllowance) : "");
    setGroupError(null);
    setGroupRevisionSnapshot(Object.fromEntries(policy.groups.map((item) => [item.id, item.revisionNo])));
  }

  function closeGroupEditor() {
    setEditingGroup(null);
    setGroupEditorOpen(false);
    setLocationIds([]);
    setGroupRevisionSnapshot({});
  }

  function toggleLocation(id: string) {
    setLocationIds((current) => current.includes(id)
      ? current.filter((locationId) => locationId !== id)
      : [...current, id]);
  }

  function openUngroupedEditor() {
    if (!ungrouped) return;
    setUngroupedMinutes(String(ungrouped.editWindowMinutes));
    setUngroupedAllowance(ungrouped.priceAllowance ? String(ungrouped.priceAllowance) : "");
    setUngroupedRevisionSnapshot(ungrouped.revision);
    setUngroupedError(null);
    setUngroupedEditorOpen(true);
  }

  function closeUngroupedEditor() {
    setUngroupedEditorOpen(false);
    setUngroupedMinutes(null);
    setUngroupedAllowance(null);
    setUngroupedRevisionSnapshot(null);
    setUngroupedError(null);
    requestAnimationFrame(() => ungroupedEditButtonRef.current?.focus());
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    return runPolicyMutation(async () => {
      try {
        const editWindowMinutes = Number(minutes);
        if (!Number.isInteger(editWindowMinutes) || editWindowMinutes < 0) throw new Error("จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
        const priceAllowance = parseMoney(allowance, "ราคาที่ซื้อเพิ่มจากราคากลาง", true);
        if (maximum && priceAllowance > maximum.value) {
          throw new Error(`ราคายางที่กำหนดต้องไม่เกิน ${maximum.value.toFixed(2)} บาท/กก.`);
        }
        const selectableLocationIds = locationIds.filter((locationId) => !policy.groups.some(
          (group) => group.id !== editingGroup?.id && group.locationIds.includes(locationId),
        ));
        if (selectableLocationIds.length === 0) throw new Error("เลือกอย่างน้อย 1 สาขา");
        if (editingGroup) {
          await policy.updateGroup({
            id: editingGroup.id,
            revisionNo: editingGroup.revisionNo,
            sourceGroupRevisions: groupRevisionSnapshot,
            locationIds: selectableLocationIds,
            editWindowMinutes,
            priceAllowance,
          });
          toast.success("แก้ไขกลุ่มแล้ว");
        } else {
          await policy.createGroup({
            locationIds: selectableLocationIds,
            editWindowMinutes,
            priceAllowance,
          });
          toast.success("สร้างกลุ่มแล้ว");
        }
        closeGroupEditor();
      } catch (caught) {
        const refreshed = getConnectivitySnapshot() ? await policy.refetch().catch(() => undefined) : undefined;
        if (refreshed?.data) {
          if (editingGroup) {
            const latestEditingGroup = refreshed.data.groups.find(
              (group) => group.id === editingGroup.id,
            );
            if (latestEditingGroup) {
              setEditingGroup(latestEditingGroup);
              setGroupRevisionSnapshot(Object.fromEntries(
                refreshed.data.groups.map((group) => [group.id, group.revisionNo]),
              ));
            } else {
              closeGroupEditor();
            }
          } else {
            const availableLocationIds = new Set(refreshed.data.availableLocationIds);
            setLocationIds((current) => current.filter((id) => availableLocationIds.has(id)));
          }
        }
        const message = caught instanceof Error ? caught.message : "บันทึกกลุ่มไม่สำเร็จ";
        setGroupError(message);
        toast.error(message);
      }
    });
  }

  async function saveUngrouped(event: React.FormEvent) {
    event.preventDefault();
    if (!ungrouped || ungroupedRevisionSnapshot === null) return;
    return runPolicyMutation(async () => {
      try {
        const editWindowMinutes = Number(ungroupedMinutes ?? ungrouped.editWindowMinutes);
        if (!Number.isInteger(editWindowMinutes) || editWindowMinutes < 0) throw new Error("จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
        const priceAllowance = parseMoney(ungroupedAllowance ?? String(ungrouped.priceAllowance), "ราคาที่ซื้อเพิ่มจากราคากลาง", true);
        if (maximum && priceAllowance > maximum.value) {
          throw new Error(`ราคายางที่กำหนดต้องไม่เกิน ${maximum.value.toFixed(2)} บาท/กก.`);
        }
        await policy.saveUngroupedDefaults({
          editWindowMinutes,
          priceAllowance,
          expectedRevision: ungroupedRevisionSnapshot,
        });
        closeUngroupedEditor();
        toast.success("บันทึกกติกาสาขาที่ยังไม่จัดกลุ่มแล้ว");
      } catch (caught) {
        const refreshed = getConnectivitySnapshot() ? await policy.refetch().catch(() => undefined) : undefined;
        if (refreshed?.data) {
          setUngroupedRevisionSnapshot(refreshed.data.ungroupedDefaults.revision);
        }
        const message = caught instanceof Error ? caught.message : "บันทึกกติกาไม่สำเร็จ";
        setUngroupedError(message);
        toast.error(message);
      }
    });
  }

  async function confirmAction() {
    return runPolicyMutation(async () => {
      if (!confirmation) return;
      try {
        if (confirmation.kind === "central") {
          await policy.saveCentralPrice({
            centralPrice: confirmation.value,
            expectedRevision: confirmation.expectedRevision,
          });
          setCentralPrice("");
          toast.success("บันทึกราคากลางแล้ว");
        } else if (confirmation.kind === "maxPriceAllowance" && maximum) {
          await policy.saveMaxPriceAllowance({
            maxPriceAllowance: confirmation.value,
            expectedMaxPriceAllowance: confirmation.previousValue,
          });
          setMaxPriceAllowance(null);
          setMaxPriceAllowanceError(null);
          toast.success("บันทึกราคายางที่กำหนดสูงสุดแล้ว");
        } else if (confirmation.kind === "autoResetEnable") {
          await policy.savePriceAllowanceAutoReset({
            enabled: true,
            expectedEnabled: confirmation.expectedEnabled,
          });
          setAutoResetError(null);
          toast.success("เปิดการรีเซ็ตราคายางอัตโนมัติแล้ว");
        } else if (confirmation.kind === "autoResetUnlock") {
          await policy.savePriceAllowanceAutoResetLock(lockInput(confirmation.target, false));
          setAutoResetLockError(null);
          toast.success("ปลดล็อกการรีเซ็ตราคายางแล้ว");
        } else if (confirmation.kind === "delete") {
          await policy.deleteGroup(confirmation.group);
          toast.success("ลบกลุ่มแล้ว");
        }
        setConfirmation(null);
      } catch (caught) {
        if (getConnectivitySnapshot()) await policy.refetch().catch(() => undefined);
        let message = caught instanceof Error ? caught.message : "บันทึกการตั้งค่าไม่สำเร็จ";
        if (confirmation.kind === "maxPriceAllowance") {
          if (caught instanceof RubberMaxPriceAllowanceError && caught.conflicts.length > 0) {
            const conflictDetails = caught.conflicts.map((conflict) => {
              const branchNames = conflict.locationIds
                .map((id) => locations.find((location) => location.id === id)?.name ?? id)
                .join(", ");
              const scope = conflict.scope === "ungrouped" ? "สาขาที่ยังไม่จัดกลุ่ม" : "กลุ่มราคา";
              return `${scope}${branchNames ? ` (${branchNames})` : ""}: ${conflict.allowance.toFixed(2)} บาท/กก.`;
            });
            message = `${message}\n${conflictDetails.join("\n")}`;
          }
          setMaxPriceAllowanceError(message);
        } else if (confirmation.kind === "autoResetEnable") {
          setAutoResetError(message);
        } else if (confirmation.kind === "autoResetUnlock") {
          setAutoResetLockError({ target: confirmation.target, message });
        }
        toast.error(message);
        setConfirmation(null);
      }
    });
  }

  if (loading) return <section className="rounded-md border border-black/10 p-4" role="status">กำลังโหลดกติกาบิลยาง...</section>;
  if (error || !central || !ungrouped || !maximum) return <section role="alert" className="rounded-md bg-rose-50 p-4 text-sm text-rose-700">{error instanceof Error ? error.message : "โหลดกติกาบิลยางไม่สำเร็จ"}</section>;

  const centralChanged = centralPrice.trim() !== "" && !isSameMoney(centralPrice, central.value);
  const shownUngroupedMinutes = ungroupedMinutes ?? String(ungrouped.editWindowMinutes);
  const shownUngroupedAllowance = ungroupedAllowance ?? (ungrouped.priceAllowance ? String(ungrouped.priceAllowance) : "");
  const shownMaxPriceAllowance = maxPriceAllowance ?? String(maximum.value);
  const maxPriceAllowanceIsUnchanged = isSameMoney(shownMaxPriceAllowance, maximum.value);
  const absoluteConfiguredMaximum = central.value + maximum.value;

  async function changeAutoReset(enabled: boolean) {
    return runPolicyMutation(async () => {
      setAutoResetError(null);
      if (enabled) {
        setConfirmation({
          kind: "autoResetEnable",
          expectedEnabled: policy.priceAllowanceAutoResetEnabled,
        });
        return;
      }
      try {
        await policy.savePriceAllowanceAutoReset({
          enabled: false,
          expectedEnabled: policy.priceAllowanceAutoResetEnabled,
        });
        toast.success("ปิดการรีเซ็ตราคายางอัตโนมัติแล้ว");
      } catch (caught) {
        if (getConnectivitySnapshot()) await policy.refetch().catch(() => undefined);
        const message = caught instanceof Error
          ? caught.message
          : "บันทึกการรีเซ็ตราคายางอัตโนมัติไม่สำเร็จ";
        setAutoResetError(message);
        toast.error(message);
      }
    });
  }

  async function changeAutoResetLock(target: AutoResetLockTarget, locked: boolean) {
    return runPolicyMutation(async () => {
      setAutoResetLockError(null);
      if (!locked) {
        setConfirmation({ kind: "autoResetUnlock", target });
        return;
      }
      try {
        await policy.savePriceAllowanceAutoResetLock(lockInput(target, true));
        toast.success("ล็อกการรีเซ็ตราคายางแล้ว");
      } catch (caught) {
        if (getConnectivitySnapshot()) await policy.refetch().catch(() => undefined);
        const message = caught instanceof Error ? caught.message : "บันทึกล็อกรีเซ็ตราคายางไม่สำเร็จ";
        setAutoResetLockError({ target, message });
        toast.error(message);
      }
    });
  }

  return (
    <div className="space-y-5">
      {!isOnline && <p role="status" className="rounded-lg bg-amber-50 p-3 text-pretty text-sm text-amber-800">การตั้งค่าบิลยางใช้ได้เมื่อออนไลน์เท่านั้น ค่าที่กรอกไว้ยังคงอยู่</p>}
      <RubberApprovalSystemSettings
        disabled={!isOnline || isBusy}
        central={central}
        maximum={maximum}
        centralPrice={centralPrice}
        maxPriceAllowance={shownMaxPriceAllowance}
        centralChanged={centralChanged}
        maximumChanged={!maxPriceAllowanceIsUnchanged}
        isSaving={isBusy}
        canEditMaximum={policy.canEditMaxPriceAllowance}
        maximumError={maxPriceAllowanceError}
        onCentralChange={setCentralPrice}
        onMaximumChange={(value) => { setMaxPriceAllowance(value); setMaxPriceAllowanceError(null); }}
        onCentralSubmit={(event) => {
          event.preventDefault();
          try {
            const value = parseMoney(centralPrice, "ราคากลาง");
            if (value <= 0) throw new Error("ราคากลางต้องมากกว่า 0");
            if (value === central.value) return toast.info("ราคากลางยังเป็นค่าเดิม");
            setConfirmation({ kind: "central", value, previousValue: central.value, expectedRevision: central.revision });
          } catch (caught) { toast.error(caught instanceof Error ? caught.message : "ราคากลางไม่ถูกต้อง"); }
        }}
        onMaximumSubmit={(event) => {
          event.preventDefault();
          try {
            const value = parseMoney(shownMaxPriceAllowance, "ราคายางที่กำหนดสูงสุด");
            if (value > 9_999_999_999.99) throw new Error("ราคายางที่กำหนดสูงสุดเกินขอบเขตที่ระบบรองรับ");
            if (value === maximum.value) return;
            setMaxPriceAllowanceError(null);
            setConfirmation({ kind: "maxPriceAllowance", value, previousValue: maximum.value });
          } catch (caught) {
            setMaxPriceAllowanceError(caught instanceof Error ? caught.message : "ข้อมูลการตั้งค่าไม่ถูกต้อง");
          }
        }}
        dateRule={dateRule}
        autoResetControl={<RubberAutoResetToggleControl
          checked={policy.priceAllowanceAutoResetEnabled}
          disabled={!policy.canEditPriceAllowanceAutoReset || policy.isSaving}
          canEdit={policy.canEditPriceAllowanceAutoReset}
          error={autoResetError}
          onChange={(checked) => void changeAutoReset(checked)}
        />}
      />

      <fieldset disabled={!isOnline || isBusy} aria-label="กลุ่มราคาและเวลา" className="min-w-0 rounded-xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-balance font-bold text-ink">กลุ่มราคาและเวลา</h3><p className="text-pretty text-sm text-ink/60">ราคาที่กำหนดคือจำนวนบาทที่ซื้อได้สูงกว่าราคากลาง; เว้นว่างเท่ากับ 0 บาท</p></div>{!groupEditorOpen && !ungroupedEditorOpen && policy.availableLocationIds.length > 0 && <button type="button" onClick={() => openGroupEditor()} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-commit px-3 text-sm font-bold text-white"><Plus size={16} /> สร้างกลุ่ม</button>}</div>
        {!policy.priceAllowanceAutoResetEnabled && <p className="mt-3 rounded-md bg-amber-50 p-3 text-pretty text-sm text-amber-800">สถานะล็อกจะมีผลเมื่อเปิดการรีเซ็ตอัตโนมัติ</p>}
        {groupEditorOpen && <form onSubmit={saveGroup} className="mt-4 space-y-4 rounded-lg border border-black/10 bg-field/40 p-4">
          <h4 className="font-semibold">{editingGroup ? "แก้ไขกลุ่ม" : "สร้างกลุ่มใหม่"}</h4>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1.5 text-sm font-semibold">เวลาแก้ไขได้ (นาที)<input aria-label="เวลาแก้ไขได้ (นาที)" type="number" min="0" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3" required /></label><label className="grid min-w-0 gap-1.5 text-sm font-semibold">ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)<input aria-label="ราคายางที่กำหนด" aria-describedby="group-allowance-help" inputMode="decimal" value={allowance} onChange={(event) => { setAllowance(event.target.value); setGroupError(null); }} placeholder="เว้นว่าง = 0 บาท" className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3 tabular-nums" /><span id="group-allowance-help" className="text-pretty text-xs font-normal text-ink/55">กรอกได้สูงสุด {maximum.value.toFixed(2)} บาท/กก. · ราคาเต็มสูงสุดปัจจุบัน {absoluteConfiguredMaximum.toFixed(2)} บาท/กก.</span></label></div>
          {groupError && <p role="alert" className="text-pretty text-sm text-rose-700">{groupError}</p>}
          <RubberApprovalGroupBranchPicker availableLocationIds={policy.availableLocationIds} editingGroupId={editingGroup?.id} groups={policy.groups} locations={locations} selectedLocationIds={locationIds} onToggle={toggleLocation} />
          <div className="flex gap-2"><button type="submit" disabled={policy.isSaving} className="focus-ring h-11 min-w-0 w-full rounded-lg bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกกลุ่ม</button><button type="button" onClick={closeGroupEditor} className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3 text-sm font-semibold">ยกเลิก</button></div>
        </form>}
        {!groupEditorOpen && <div className="mt-3 space-y-2" data-testid="approval-group-list">
          <article data-testid="ungrouped-approval-settings" className="min-w-0 rounded-lg border border-black/10 bg-field/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold">สาขาที่ยังไม่จัดกลุ่ม</h4>
                {!ungroupedEditorOpen && <p className="text-sm text-ink/60">{ungrouped.locationIds.length ? ungrouped.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ") : "ยังไม่มีสาขาที่ใช้ค่านี้"}</p>}
              </div>
              {!ungroupedEditorOpen && <button ref={ungroupedEditButtonRef} type="button" onClick={openUngroupedEditor} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-river/30 px-3 text-sm font-semibold text-river"><Pencil aria-hidden="true" size={15} /> แก้ไข</button>}
            </div>
            {ungroupedEditorOpen ? <form onSubmit={saveUngrouped} className="mt-4 space-y-4 rounded-lg border border-black/10 bg-field/40 p-4">
              <section aria-labelledby="ungrouped-location-heading">
                <h5 id="ungrouped-location-heading" className="text-sm font-semibold">สาขาในกลุ่ม</h5>
                <p className="text-sm text-ink/60">{ungrouped.locationIds.length ? ungrouped.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ") : "ยังไม่มีสาขาที่ใช้ค่านี้"}</p>
              </section>
              <h5 className="text-sm font-semibold">แก้ไขการตั้งค่า</h5>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1.5 text-sm font-semibold">เวลาแก้ไขได้ (นาที)<input autoFocus aria-describedby={ungroupedError ? "ungrouped-error" : undefined} aria-invalid={ungroupedError ? true : undefined} type="number" min="0" step="1" value={shownUngroupedMinutes} onChange={(event) => { setUngroupedMinutes(event.target.value); setUngroupedError(null); }} className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 bg-white px-3" required /></label>
                <label className="grid min-w-0 gap-1.5 text-sm font-semibold">ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)<input aria-describedby={ungroupedError ? "ungrouped-allowance-help ungrouped-error" : "ungrouped-allowance-help"} aria-invalid={ungroupedError ? true : undefined} inputMode="decimal" value={shownUngroupedAllowance} onChange={(event) => { setUngroupedAllowance(event.target.value); setUngroupedError(null); }} placeholder="เว้นว่าง = 0 บาท" className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 bg-white px-3 tabular-nums" /><span id="ungrouped-allowance-help" className="text-pretty text-xs font-normal text-ink/55">กรอกได้สูงสุด {maximum.value.toFixed(2)} บาท/กก. · ราคาเต็มสูงสุดปัจจุบัน {absoluteConfiguredMaximum.toFixed(2)} บาท/กก.</span></label>
              </div>
              {ungroupedError && <p id="ungrouped-error" role="alert" className="text-pretty text-sm text-rose-700">{ungroupedError}</p>}
              <p className="text-pretty text-xs text-ink/60">{actorText(ungrouped.updatedByName, ungrouped.updatedAt)}</p>
              <div className="flex gap-2"><button type="submit" disabled={policy.isSaving} className="focus-ring h-11 min-w-0 w-full rounded-lg bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกการตั้งค่า</button><button type="button" disabled={policy.isSaving} onClick={closeUngroupedEditor} className="focus-ring h-11 min-w-0 w-full rounded-lg border border-black/15 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">ยกเลิก</button></div>
            </form> : <>
              <p className="mt-2 text-sm">เวลา {ungrouped.editWindowMinutes} นาที · ราคากลาง {central.value.toFixed(2)} + ราคายางที่กำหนด {ungrouped.priceAllowance.toFixed(2)} = ซื้อได้สูงสุด {(central.value + ungrouped.priceAllowance).toFixed(2)} บาท/กก.</p>
              <p className="mt-1 text-pretty text-xs text-ink/60">{actorText(ungrouped.updatedByName, ungrouped.updatedAt)}</p>
            </>}
            <RubberAutoResetLockControl checked={ungrouped.priceAllowanceAutoResetLocked} disabled={!policy.canEditPriceAllowanceAutoReset || policy.isSaving} canEdit={policy.canEditPriceAllowanceAutoReset} label="ไม่รีเซ็ตราคาสาขาที่ยังไม่จัดกลุ่มเมื่อครบ 24 ชั่วโมง" error={autoResetLockError?.target.scope === "ungrouped" ? autoResetLockError.message : undefined} testId="auto-reset-lock-ungrouped" onChange={(locked) => void changeAutoResetLock({ scope: "ungrouped", label: "สาขาที่ยังไม่จัดกลุ่ม", expectedLocked: ungrouped.priceAllowanceAutoResetLocked }, locked)} />
          </article>
          {policy.groups.map((group, index) => <article key={group.id} className="flex flex-col gap-3 min-w-0 rounded-lg border border-black/10 bg-field/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="font-semibold">กลุ่ม {index + 1}</h4><p className="text-sm text-ink/60">{group.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ")}</p><p className="text-sm">เวลา {group.editWindowMinutes} นาที · ราคากลาง {central.value.toFixed(2)} + กำหนด {group.priceAllowance.toFixed(2)} = ซื้อได้สูงสุด {(central.value + group.priceAllowance).toFixed(2)} บาท/กก.</p><p className="text-pretty text-xs text-ink/60">{actorText(group.updatedByName ?? "", group.updatedAt)}</p><RubberAutoResetLockControl checked={group.priceAllowanceAutoResetLocked} disabled={!policy.canEditPriceAllowanceAutoReset || policy.isSaving} canEdit={policy.canEditPriceAllowanceAutoReset} label="ไม่รีเซ็ตราคากลุ่มนี้เมื่อครบ 24 ชั่วโมง" error={autoResetLockError?.target.scope === "group" && autoResetLockError.target.groupId === group.id ? autoResetLockError.message : undefined} testId={`auto-reset-lock-group-${group.id}`} onChange={(locked) => void changeAutoResetLock({ scope: "group", groupId: group.id, label: `กลุ่ม ${index + 1}`, expectedLocked: group.priceAllowanceAutoResetLocked }, locked)} /></div>{!ungroupedEditorOpen && <div className="flex gap-2"><button type="button" onClick={() => openGroupEditor(group)} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-river/30 px-3 text-sm font-semibold text-river"><Pencil size={15} /> แก้ไข</button><button type="button" onClick={() => setConfirmation({ kind: "delete", group })} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-semibold text-white"><Trash2 size={15} /> ลบ</button></div>}</article>)}
        </div>}
      </fieldset>

      <AlertDialog
        open={confirmation !== null}
        title={confirmation?.kind === "central"
          ? "ยืนยันเปลี่ยนราคากลาง?"
          : confirmation?.kind === "maxPriceAllowance"
            ? "ยืนยันเปลี่ยนราคายางที่กำหนดสูงสุด?"
            : confirmation?.kind === "autoResetEnable"
              ? "เปิดการรีเซ็ตราคายางอัตโนมัติ?"
              : confirmation?.kind === "autoResetUnlock"
                ? `ปลดล็อก ${confirmation.target.label}?`
                : "ลบกลุ่มนี้?"}
        description={confirmation?.kind === "central"
          ? `เปลี่ยนจาก ${confirmation.previousValue.toFixed(2)} เป็น ${confirmation.value.toFixed(2)} บาท/กก. เพดานของทุกกลุ่มจะเปลี่ยนทันทีสำหรับบิลใหม่ โดยไม่เปลี่ยนคำขอเดิม`
          : confirmation?.kind === "maxPriceAllowance"
            ? `เปลี่ยนจาก ${confirmation.previousValue.toFixed(2)} เป็น ${confirmation.value.toFixed(2)} บาท/กก. โดยไม่แก้ค่ากลุ่มเดิมอัตโนมัติ`
            : confirmation?.kind === "autoResetEnable"
              ? "กลุ่มหรือสาขาที่ยังไม่จัดกลุ่มซึ่งเกิน 24 ชั่วโมงแล้วอาจถูกรีเซ็ตเป็น 0 ในรอบตรวจถัดไป และระบบไม่สามารถคืนราคาเดิมให้อัตโนมัติ"
              : confirmation?.kind === "autoResetUnlock"
                ? "ราคาที่ยังไม่เป็น 0 และครบ 24 ชั่วโมงแล้วอาจถูกรีเซ็ตในรอบตรวจถัดไป การปลดล็อกนี้ไม่แก้ราคาทันที"
                : "สาขาในกลุ่มจะกลับไปใช้กติกาสาขาที่ยังไม่จัดกลุ่ม"}
        confirmLabel={confirmation?.kind === "central"
          ? "ยืนยันราคากลาง"
          : confirmation?.kind === "maxPriceAllowance"
            ? "ยืนยันค่าสูงสุด"
            : confirmation?.kind === "autoResetEnable"
              ? "ยืนยันเปิดใช้งาน"
              : confirmation?.kind === "autoResetUnlock"
                ? "ยืนยันปลดล็อก"
                : "ยืนยัน"}
        busy={isBusy}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}
