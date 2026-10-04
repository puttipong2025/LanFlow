"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { useRubberApprovalGroups } from "@/hooks/useRubberApprovalGroups";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import type { Location, RubberApprovalGroup } from "@/types";

type PendingConfirmation =
  | { kind: "central"; value: number }
  | { kind: "quota"; value: number }
  | { kind: "delete"; group: RubberApprovalGroup };

function parseMoney(value: string, label: string, allowBlank = false) {
  const normalized = value.trim();
  if (allowBlank && normalized === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`${label}ต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
  return Number(normalized);
}

function actorText(name: string, updatedAt: string) {
  return `แก้ไขล่าสุดโดย ${name || "ไม่ทราบชื่อ"} · ${formatBangkokDateTime(updatedAt)}`;
}

export function RubberApprovalPolicyPanel({
  locations,
  locationsLoading,
  locationsError,
}: {
  locations: Location[];
  locationsLoading: boolean;
  locationsError: Error | null;
}) {
  const policy = useRubberApprovalGroups(locations.map((location) => location.id));
  const [centralPrice, setCentralPrice] = useState("");
  const [quotaLimit, setQuotaLimit] = useState("");
  const [editingGroup, setEditingGroup] = useState<RubberApprovalGroup | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [minutes, setMinutes] = useState("30");
  const [allowance, setAllowance] = useState("");
  const [groupRevisionSnapshot, setGroupRevisionSnapshot] = useState<Record<string, number>>({});
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [ungroupedMinutes, setUngroupedMinutes] = useState<string | null>(null);
  const [ungroupedAllowance, setUngroupedAllowance] = useState<string | null>(null);

  const central = policy.centralPrice;
  const ungrouped = policy.ungroupedDefaults;
  const quota = policy.quota;
  const loading = policy.isLoading || locationsLoading;
  const error = policy.error ?? locationsError;

  function openGroupEditor(group?: RubberApprovalGroup) {
    setEditingGroup(group ?? null);
    setGroupEditorOpen(true);
    setLocationIds(group?.locationIds ?? []);
    setMinutes(String(group?.editWindowMinutes ?? 30));
    setAllowance(group?.priceAllowance ? String(group.priceAllowance) : "");
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

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    try {
      const editWindowMinutes = Number(minutes);
      if (!Number.isInteger(editWindowMinutes) || editWindowMinutes < 0) throw new Error("จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      const priceAllowance = parseMoney(allowance, "ราคาที่ซื้อเพิ่มจากราคากลาง", true);
      if (locationIds.length === 0) throw new Error("เลือกอย่างน้อย 1 สาขา");
      if (editingGroup) {
        await policy.updateGroup({
          id: editingGroup.id,
          revisionNo: editingGroup.revisionNo,
          sourceGroupRevisions: groupRevisionSnapshot,
          locationIds,
          editWindowMinutes,
          priceAllowance,
        });
        toast.success("แก้ไขกลุ่มแล้ว");
      } else {
        await policy.createGroup({ locationIds, editWindowMinutes, priceAllowance });
        toast.success("สร้างกลุ่มแล้ว");
      }
      closeGroupEditor();
    } catch (caught) {
      await policy.refetch();
      toast.error(caught instanceof Error ? caught.message : "บันทึกกลุ่มไม่สำเร็จ");
    }
  }

  async function saveUngrouped(event: React.FormEvent) {
    event.preventDefault();
    if (!ungrouped) return;
    try {
      const editWindowMinutes = Number(ungroupedMinutes ?? ungrouped.editWindowMinutes);
      if (!Number.isInteger(editWindowMinutes) || editWindowMinutes < 0) throw new Error("จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      const priceAllowance = parseMoney(ungroupedAllowance ?? String(ungrouped.priceAllowance), "ราคาที่ซื้อเพิ่มจากราคากลาง", true);
      await policy.saveUngroupedDefaults({ editWindowMinutes, priceAllowance, expectedRevision: ungrouped.revision });
      setUngroupedMinutes(null);
      setUngroupedAllowance(null);
      toast.success("บันทึกกติกาสาขาที่ยังไม่จัดกลุ่มแล้ว");
    } catch (caught) {
      await policy.refetch();
      toast.error(caught instanceof Error ? caught.message : "บันทึกกติกาไม่สำเร็จ");
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    try {
      if (confirmation.kind === "central" && central) {
        await policy.saveCentralPrice({ centralPrice: confirmation.value, expectedRevision: central.revision });
        setCentralPrice("");
        toast.success("บันทึกราคากลางแล้ว");
      } else if (confirmation.kind === "quota" && quota) {
        await policy.saveQuota({ quotaLimit: confirmation.value, expectedRoundId: quota.roundId });
        setQuotaLimit("");
        toast.success("ตั้งโควต้าใหม่และรีเซ็ตการใช้งานแล้ว");
      } else if (confirmation.kind === "delete") {
        await policy.deleteGroup(confirmation.group);
        toast.success("ลบกลุ่มแล้ว");
      }
      setConfirmation(null);
    } catch (caught) {
      await policy.refetch();
      toast.error(caught instanceof Error ? caught.message : "บันทึกการตั้งค่าไม่สำเร็จ");
      setConfirmation(null);
    }
  }

  if (loading) return <section className="rounded-md border border-black/10 p-4" role="status">กำลังโหลดกติกาบิลยาง...</section>;
  if (error || !central || !ungrouped || !quota) return <section role="alert" className="rounded-md bg-rose-50 p-4 text-sm text-rose-700">{error instanceof Error ? error.message : "โหลดกติกาบิลยางไม่สำเร็จ"}</section>;

  const editorLocationIds = editingGroup
    ? [...new Set([...policy.availableLocationIds, ...policy.groups.flatMap((group) => group.locationIds)])]
    : policy.availableLocationIds;
  const enteredCentral = centralPrice.trim() === "" ? null : Number(centralPrice);
  const centralChanged = enteredCentral !== null && enteredCentral !== central.value;
  const shownUngroupedMinutes = ungroupedMinutes ?? String(ungrouped.editWindowMinutes);
  const shownUngroupedAllowance = ungroupedAllowance ?? (ungrouped.priceAllowance ? String(ungrouped.priceAllowance) : "");
  const shownQuota = quotaLimit || String(quota.limitPerAdmin);

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-black/10 p-4">
        <h3 className="font-bold text-ink">ราคากลางยางทั้งระบบ</h3>
        <p className="mt-1 text-sm text-ink/60">ราคากลางปัจจุบัน <strong className="tabular-nums text-ink">{central.value.toFixed(2)} บาท/กก.</strong></p>
        <p className="mt-1 text-xs text-ink/50">{actorText(central.updatedByName, central.updatedAt)}</p>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          try {
            const value = parseMoney(centralPrice, "ราคากลาง");
            if (value <= 0) throw new Error("ราคากลางต้องมากกว่า 0");
            if (value === central.value) return toast.info("ราคากลางยังเป็นค่าเดิม");
            setConfirmation({ kind: "central", value });
          } catch (caught) { toast.error(caught instanceof Error ? caught.message : "ราคากลางไม่ถูกต้อง"); }
        }}>
          <label className="grid gap-1 text-sm font-semibold">ราคากลางใหม่ (บาท/กก.)<input aria-label="ราคากลางใหม่" inputMode="decimal" value={centralPrice} onChange={(event) => setCentralPrice(event.target.value)} placeholder={central.value.toFixed(2)} className="focus-ring h-10 w-48 rounded-md border border-black/15 px-3 tabular-nums" /></label>
          <button type="submit" disabled={!centralChanged || policy.isSaving} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">เปลี่ยนราคากลาง</button>
        </form>
      </section>

      <section className="rounded-md border border-black/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-ink">กลุ่มราคาและเวลา</h3><p className="text-sm text-ink/60">ราคาที่กำหนดคือจำนวนบาทที่ซื้อได้สูงกว่าราคากลาง; เว้นว่างเท่ากับ 0 บาท</p></div>{!groupEditorOpen && policy.availableLocationIds.length > 0 && <button type="button" onClick={() => openGroupEditor()} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-commit px-3 text-sm font-bold text-white"><Plus size={16} /> สร้างกลุ่ม</button>}</div>
        {groupEditorOpen && <form onSubmit={saveGroup} className="mt-3 space-y-3 rounded-md bg-field/55 p-3">
          <h4 className="font-semibold">{editingGroup ? "แก้ไขกลุ่ม" : "สร้างกลุ่มใหม่"}</h4>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">เวลาแก้ไขได้ (นาที)<input aria-label="เวลาแก้ไขได้ (นาที)" type="number" min="0" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="focus-ring h-10 rounded-md border border-black/15 px-3" required /></label><label className="grid gap-1 text-sm font-semibold">ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)<input aria-label="ราคายางที่กำหนด" inputMode="decimal" value={allowance} onChange={(event) => setAllowance(event.target.value)} placeholder="เว้นว่าง = 0 บาท" className="focus-ring h-10 rounded-md border border-black/15 px-3" /></label></div>
          <fieldset><legend className="mb-2 text-sm font-semibold">สาขาในกลุ่ม</legend><div className="grid gap-2 sm:grid-cols-2">{editorLocationIds.map((id) => { const location = locations.find((item) => item.id === id); return location ? <label key={id} className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={locationIds.includes(id)} onChange={() => toggleLocation(id)} />{location.name}</label> : null; })}</div></fieldset>
          <div className="flex gap-2"><button type="submit" disabled={policy.isSaving} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกกลุ่ม</button><button type="button" onClick={closeGroupEditor} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm font-semibold">ยกเลิก</button></div>
        </form>}
        {!groupEditorOpen && <div className="mt-3 space-y-2" data-testid="approval-group-list">
          <form onSubmit={saveUngrouped} className="rounded-md border border-dashed border-black/20 bg-field/40 p-3">
            <h4 className="font-semibold">สาขาที่ยังไม่จัดกลุ่ม</h4><p className="text-sm text-ink/60">{ungrouped.locationIds.length ? ungrouped.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ") : "ยังไม่มีสาขาที่ใช้ค่านี้"}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">เวลาแก้ไขได้ (นาที)<input type="number" min="0" step="1" value={shownUngroupedMinutes} onChange={(event) => setUngroupedMinutes(event.target.value)} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3" /></label><label className="grid gap-1 text-sm font-semibold">ราคายางที่กำหนด — ซื้อเกินราคากลางได้ (บาท/กก.)<input inputMode="decimal" value={shownUngroupedAllowance} onChange={(event) => setUngroupedAllowance(event.target.value)} placeholder="เว้นว่าง = 0 บาท" className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3" /></label></div>
            <p className="mt-2 text-xs text-ink/50">{actorText(ungrouped.updatedByName, ungrouped.updatedAt)}</p><button type="submit" disabled={policy.isSaving} className="focus-ring mt-3 h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">บันทึกกติกาสาขาที่ยังไม่จัดกลุ่ม</button>
          </form>
          {policy.groups.map((group, index) => <article key={group.id} className="flex flex-col gap-3 rounded-md border border-black/10 p-3 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="font-semibold">กลุ่ม {index + 1}</h4><p className="text-sm text-ink/60">{group.locationIds.map((id) => locations.find((location) => location.id === id)?.name ?? id).join(", ")}</p><p className="text-sm">เวลา {group.editWindowMinutes} นาที · ราคากลาง {central.value.toFixed(2)} + กำหนด {group.priceAllowance.toFixed(2)} = ซื้อได้สูงสุด {(central.value + group.priceAllowance).toFixed(2)} บาท/กก.</p><p className="text-xs text-ink/50">{actorText(group.updatedByName ?? "", group.updatedAt)}</p></div><div className="flex gap-2"><button type="button" onClick={() => openGroupEditor(group)} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-river/30 px-3 text-sm font-semibold text-river"><Pencil size={15} /> แก้ไข</button><button type="button" onClick={() => setConfirmation({ kind: "delete", group })} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-semibold text-white"><Trash2 size={15} /> ลบ</button></div></article>)}
        </div>}
      </section>

      <section className="rounded-md border border-black/10 p-4">
        <h3 className="font-bold text-ink">โควต้าราคาสำหรับ Admin</h3><p className="mt-1 text-sm text-ink/60">แต่ละ Admin ใช้ได้ {quota.limitPerAdmin} รายการต่อวัน และนับแยกบัญชี รีเซ็ตเที่ยงคืนเวลาไทย</p><p className="mt-1 text-xs text-ink/50">{actorText(quota.updatedByName, quota.updatedAt)}</p>
        {policy.canEditQuota ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const value = Number(shownQuota); if (!Number.isInteger(value) || value < 0) return toast.error("โควต้าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป"); setConfirmation({ kind: "quota", value }); }}><label className="grid gap-1 text-sm font-semibold">จำนวนรายการต่อ Admin<input aria-label="จำนวนโควต้าต่อ Admin" type="number" min="0" step="1" value={shownQuota} onChange={(event) => setQuotaLimit(event.target.value)} className="focus-ring h-10 w-48 rounded-md border border-black/15 px-3" /></label><button type="submit" disabled={policy.isSaving} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">ตั้งโควต้าและรีเซ็ต</button></form> : <p className="mt-3 rounded-md bg-field/55 p-3 text-sm text-ink/60">เฉพาะ Superadmin เท่านั้นที่ตั้งและรีเซ็ตโควต้าได้</p>}
      </section>

      <AlertDialog open={confirmation !== null} title={confirmation?.kind === "central" ? "ยืนยันเปลี่ยนราคากลาง?" : confirmation?.kind === "quota" ? "ตั้งโควต้าและรีเซ็ตการใช้งาน?" : "ลบกลุ่มนี้?"} description={confirmation?.kind === "central" ? `เปลี่ยนจาก ${central.value.toFixed(2)} เป็น ${confirmation.value.toFixed(2)} บาท/กก. เพดานของทุกกลุ่มจะเปลี่ยนทันทีสำหรับบิลใหม่ โดยไม่รีเซ็ตโควต้าหรือเปลี่ยนคำขอเดิม` : confirmation?.kind === "quota" ? `เปลี่ยนโควต้า Admin ทุกคนจาก ${quota.limitPerAdmin} เป็น ${confirmation.value} รายการ และยอดใช้เดิมจะถูกรีเซ็ตทันที แม้ตั้งค่าเท่าเดิม` : "สาขาในกลุ่มจะกลับไปใช้กติกาสาขาที่ยังไม่จัดกลุ่ม"} confirmLabel={confirmation?.kind === "central" ? "ยืนยันราคากลาง" : confirmation?.kind === "quota" ? "ยืนยันการตั้งค่า" : "ยืนยัน"} busy={policy.isSaving} onCancel={() => setConfirmation(null)} onConfirm={() => void confirmAction()} />
    </div>
  );
}
