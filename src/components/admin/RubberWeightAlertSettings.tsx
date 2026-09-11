"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Pencil, Plus, Trash2 } from "lucide-react";

import { AlertDialog } from "@/components/shared/AlertDialog";
import { useLocations } from "@/hooks/useLocations";
import { useRubberWeightAlertGroups } from "@/hooks/useRubberWeightAlertGroups";
import { authFetch } from "@/lib/auth-fetch";
import { formatNumber } from "@/lib/format";
import {
  RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES,
  RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG,
  RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES,
  RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG,
  parseRubberWeightAlertConfig,
  validRubberWeightAlertInterval,
  validRubberWeightAlertThreshold,
  type RubberWeightAlertConfig,
} from "@/lib/lanflow/rubber-weight-alert";
import type { RubberWeightAlertGroup } from "@/types";

export function RubberWeightAlertSettings({
  initialConfig,
  onAccessDenied,
  onSaved,
}: {
  initialConfig: RubberWeightAlertConfig;
  onAccessDenied: () => void;
  onSaved: (config: RubberWeightAlertConfig) => void;
}) {
  const { locations, isLoading: locationsLoading, error: locationsError } = useLocations();
  const groups = useRubberWeightAlertGroups();
  const [savedInterval, setSavedInterval] = useState(initialConfig.intervalMinutes);
  const [intervalValue, setIntervalValue] = useState(String(initialConfig.intervalMinutes));
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [intervalSuccess, setIntervalSuccess] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<RubberWeightAlertGroup | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [groupLocationIds, setGroupLocationIds] = useState<string[]>([]);
  const [thresholdValue, setThresholdValue] = useState(String(initialConfig.thresholdKg));
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<RubberWeightAlertGroup | null>(null);

  const intervalMinutes = Number(intervalValue);
  const thresholdKg = Number(thresholdValue);
  const intervalValid = validRubberWeightAlertInterval(intervalMinutes);
  const thresholdValid = validRubberWeightAlertThreshold(thresholdKg);
  const intervalDirty = intervalValue !== String(savedInterval);

  useEffect(() => {
    if (initialConfig.intervalMinutes === savedInterval || intervalDirty) return;
    setSavedInterval(initialConfig.intervalMinutes);
    setIntervalValue(String(initialConfig.intervalMinutes));
  }, [initialConfig.intervalMinutes, intervalDirty, savedInterval]);

  useEffect(() => {
    const error = groups.error ?? locationsError;
    if (error instanceof Error && error.message.includes("ไม่มีสิทธิ์")) onAccessDenied();
  }, [groups.error, locationsError, onAccessDenied]);

  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const editorLocationIds = editingGroup
    ? [...new Set([...groups.availableLocationIds, ...editingGroup.locationIds])]
    : groups.availableLocationIds;

  async function saveInterval(event: React.FormEvent) {
    event.preventDefault();
    if (!intervalValid) {
      setIntervalError("รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที");
      return;
    }
    setSavingInterval(true);
    setIntervalError(null);
    setIntervalSuccess(null);
    try {
      const response = await authFetch("/api/lanflow/admin/rubber-weight-alert", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalMinutes }),
      });
      const data = await response.json().catch(() => ({})) as unknown;
      if (response.status === 401 || response.status === 403) {
        onAccessDenied();
        return;
      }
      const config = parseRubberWeightAlertConfig(data);
      if (!response.ok || !config) {
        const message = data && typeof data === "object" && "error" in data
          ? String(data.error)
          : "บันทึกรอบตรวจไม่สำเร็จ";
        throw new Error(message);
      }
      setSavedInterval(config.intervalMinutes);
      setIntervalValue(String(config.intervalMinutes));
      onSaved(config);
      setIntervalSuccess("บันทึกรอบตรวจแล้ว");
    } catch (error) {
      setIntervalError(error instanceof Error ? error.message : "บันทึกรอบตรวจไม่สำเร็จ");
    } finally {
      setSavingInterval(false);
    }
  }

  function openEditor(group?: RubberWeightAlertGroup) {
    setEditingGroup(group ?? null);
    setGroupLocationIds(group?.locationIds ?? []);
    setThresholdValue(String(group?.thresholdKg ?? initialConfig.thresholdKg));
    setGroupError(null);
    setGroupSuccess(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditingGroup(null);
    setGroupLocationIds([]);
    setGroupError(null);
    setEditorOpen(false);
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    if (groupLocationIds.length === 0 || !thresholdValid) {
      setGroupError(groupLocationIds.length === 0
        ? "เลือกสาขาอย่างน้อยหนึ่งสาขา"
        : "เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก.");
      return;
    }
    setGroupError(null);
    setGroupSuccess(null);
    try {
      const input = { locationIds: groupLocationIds, thresholdKg };
      if (editingGroup) {
        await groups.updateGroup({ id: editingGroup.id, ...input });
        closeEditor();
        setGroupSuccess("แก้ไขกลุ่มแล้ว การตรวจรอบถัดไปจะใช้ค่าใหม่");
      } else {
        await groups.createGroup(input);
        closeEditor();
        setGroupSuccess("สร้างกลุ่มแล้ว การตรวจรอบถัดไปจะเริ่มใช้กลุ่มนี้");
      }
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "บันทึกกลุ่มไม่สำเร็จ");
    }
  }

  const loading = groups.isLoading || locationsLoading;
  const loadError = groups.error ?? locationsError;

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="max-w-2xl">
          <h3 className="flex items-center gap-2 text-balance text-lg font-bold text-ink">
            <BellRing aria-hidden="true" size={19} />
            รอบตรวจส่วนกลาง
          </h3>
          <p className="mt-1 text-pretty text-sm text-ink/60">
            ใช้รอบเดียวกับทุกกลุ่ม และแจ้งซ้ำเมื่อถึงรอบตรวจถัดไป
          </p>
          <form className="mt-4 max-w-sm space-y-3" noValidate onSubmit={saveInterval}>
            <label className="grid gap-1 text-sm font-semibold" htmlFor="rubber-weight-alert-interval">
              รอบตรวจ (นาที)
              <input
                id="rubber-weight-alert-interval"
                type="number"
                inputMode="numeric"
                min={RUBBER_WEIGHT_ALERT_MIN_INTERVAL_MINUTES}
                max={RUBBER_WEIGHT_ALERT_MAX_INTERVAL_MINUTES}
                step={1}
                value={intervalValue}
                disabled={savingInterval}
                aria-invalid={!intervalValid}
                aria-describedby="rubber-weight-alert-interval-hint"
                onChange={(event) => {
                  setIntervalValue(event.target.value);
                  setIntervalError(null);
                  setIntervalSuccess(null);
                }}
                className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field"
              />
            </label>
            <p id="rubber-weight-alert-interval-hint" className="text-pretty text-sm text-ink/60">
              ตั้งได้ 1–1,440 นาที ค่าเริ่มต้น 60 นาที
            </p>
            {intervalError && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">{intervalError}</p>}
            {intervalSuccess && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-pretty text-sm text-emerald-900">{intervalSuccess}</p>}
            <button type="submit" disabled={savingInterval || !intervalDirty} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {savingInterval ? "กำลังบันทึก..." : "บันทึกรอบตรวจ"}
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-balance text-lg font-bold text-ink">กลุ่มเกณฑ์น้ำหนัก</h3>
            <p className="mt-1 text-pretty text-sm text-ink/60">สาขานอกกลุ่มจะไม่แจ้งเตือนน้ำหนัก</p>
          </div>
          {!editorOpen && !loading && !loadError && groups.availableLocationIds.length > 0 && (
            <button type="button" onClick={() => openEditor()} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-commit px-3 text-sm font-bold text-white">
              <Plus aria-hidden="true" size={16} /> สร้างกลุ่ม
            </button>
          )}
        </div>

        {groupSuccess && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-pretty text-sm text-emerald-900">{groupSuccess}</p>}
        {groupError && !editorOpen && <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">{groupError}</p>}
        {loading ? (
          <p role="status" className="mt-4 text-sm text-ink/60">กำลังโหลดกลุ่ม...</p>
        ) : loadError ? (
          <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">
            {loadError instanceof Error ? loadError.message : "โหลดกลุ่มไม่สำเร็จ"}
          </p>
        ) : editorOpen ? (
          <form onSubmit={saveGroup} noValidate className="mt-4 space-y-4 rounded-md bg-field/55 p-3">
            <h4 className="text-balance font-semibold text-ink">
              {editingGroup ? `แก้ไขกลุ่ม ${groups.groups.findIndex((group) => group.id === editingGroup.id) + 1}` : "สร้างกลุ่มใหม่"}
            </h4>
            <label className="grid max-w-sm gap-1 text-sm font-semibold" htmlFor="rubber-weight-alert-threshold">
              เกณฑ์น้ำหนักสุทธิสะสม (กก.)
              <input
                id="rubber-weight-alert-threshold"
                type="number"
                inputMode="numeric"
                min={RUBBER_WEIGHT_ALERT_MIN_THRESHOLD_KG}
                max={RUBBER_WEIGHT_ALERT_MAX_THRESHOLD_KG}
                step={1}
                value={thresholdValue}
                disabled={groups.isSaving}
                aria-invalid={!thresholdValid}
                onChange={(event) => { setThresholdValue(event.target.value); setGroupError(null); }}
                className="focus-ring h-11 rounded-md border border-black/15 px-3 text-base tabular-nums disabled:bg-field"
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">สาขาในกลุ่ม</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {editorLocationIds.map((id) => {
                  const location = locationById.get(id);
                  if (!location) return null;
                  const retainedInactive = !location.active && editingGroup?.locationIds.includes(id);
                  return (
                    <label key={id} className="flex min-h-11 items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={groupLocationIds.includes(id)}
                        disabled={groups.isSaving || retainedInactive}
                        onChange={() => {
                          setGroupLocationIds((current) => current.includes(id)
                            ? current.filter((locationId) => locationId !== id)
                            : [...current, id]);
                          setGroupError(null);
                        }}
                        className="size-4 accent-river"
                      />
                      <span className="min-w-0 text-pretty">{location.name}</span>
                      {!location.active && <span className="ml-auto shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-ink/55">ปิดใช้งาน</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {groupError && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">{groupError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={groups.isSaving || groupLocationIds.length === 0} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:opacity-50">
                {groups.isSaving ? "กำลังบันทึก..." : "บันทึกกลุ่ม"}
              </button>
              <button type="button" disabled={groups.isSaving} onClick={closeEditor} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold disabled:opacity-50">ยกเลิก</button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-2" data-testid="rubber-weight-alert-group-list">
            {groups.availableLocationIds.length > 0 && (
              <div className="rounded-md border border-dashed border-black/15 bg-field/40 p-3">
                <h4 className="text-balance font-semibold text-ink">ยังไม่จัดกลุ่ม</h4>
                <p className="mt-1 text-pretty text-sm text-ink/60">
                  {groups.availableLocationIds.map((id) => locationById.get(id)?.name ?? id).join(", ")}
                </p>
                <p className="mt-1 text-pretty text-sm text-ink/70">ไม่แจ้งเตือนน้ำหนัก</p>
              </div>
            )}
            {groups.groups.length === 0 && groups.availableLocationIds.length === 0 && (
              <p className="text-pretty text-sm text-ink/60">ยังไม่มีกลุ่ม และไม่มีสาขาให้เลือกเพิ่ม</p>
            )}
            {groups.groups.map((group, index) => (
              <article key={group.id} className="flex flex-col gap-3 rounded-md border border-black/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h4 className="font-semibold text-ink">กลุ่ม {index + 1}</h4>
                  <p className="mt-1 text-pretty text-sm text-ink/60">
                    {group.locationIds.map((id) => {
                      const location = locationById.get(id);
                      return `${location?.name ?? id}${location && !location.active ? " (ปิดใช้งาน)" : ""}`;
                    }).join(", ")}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">เกณฑ์ <span className="font-semibold tabular-nums">{formatNumber(group.thresholdKg)} กก.</span></p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => openEditor(group)} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-river/30 px-3 text-sm font-semibold text-river">
                    <Pencil aria-hidden="true" size={15} /> แก้ไข
                  </button>
                  <button type="button" disabled={groups.isSaving} onClick={() => setGroupToDelete(group)} className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                    <Trash2 aria-hidden="true" size={15} /> ลบ
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <AlertDialog
        open={groupToDelete !== null}
        title="ลบกลุ่มนี้?"
        description="สาขาในกลุ่มจะกลับไปอยู่ในรายการยังไม่จัดกลุ่มและจะไม่รับการแจ้งเตือนน้ำหนัก"
        confirmLabel="ยืนยันลบกลุ่ม"
        busy={groups.isSaving}
        onCancel={() => setGroupToDelete(null)}
        onConfirm={() => {
          if (!groupToDelete) return;
          setGroupError(null);
          setGroupSuccess(null);
          void groups.deleteGroup(groupToDelete.id)
            .then(() => setGroupSuccess("ลบกลุ่มแล้ว สาขาเดิมจะไม่รับการแจ้งเตือน"))
            .catch((error) => setGroupError(error instanceof Error ? error.message : "ลบกลุ่มไม่สำเร็จ"))
            .finally(() => setGroupToDelete(null));
        }}
      />
    </div>
  );
}
