"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ModalShell } from "@/components/shared/ModalShell";
import type {
  ExportVehicleWeighBillLineInput,
  ExportVehicleWeighBillPayload,
} from "@/hooks/useExportVehicleWeighBills";
import {
  exportVehicleRoleLabel,
  formatExportVehicleWeighBillNumber,
} from "@/lib/export-vehicle-weigh-bills/presentation";
import {
  bangkokDateTimeInput,
  bangkokDateTimeInputToMillis,
  bangkokDateTimeInputToIso,
  currentBangkokDateTimeAfter,
  currentBangkokDateTimeNotBefore,
  initialWexTruckInboundAt,
} from "@/lib/export-vehicle-weigh-bills/timing";
import { cn } from "@/lib/cn";
import type { WexCarrierOption, WexDetails, WexRubberExportOption } from "@/types/export-vehicle-weigh-bills";

type DraftLine = {
  vehicleRegistration: string;
  carrierId: string | null;
  carrierName: string;
  inboundAt: string;
  inboundWeight: string;
  outboundAt: string;
  outboundWeight: string;
};

function emptyLine(inboundAt = bangkokDateTimeInput()): DraftLine {
  return {
    vehicleRegistration: "",
    carrierId: null,
    carrierName: "",
    inboundAt,
    inboundWeight: "0",
    outboundAt: "",
    outboundWeight: "0",
  };
}

function detailLine(line: WexDetails["lines"][number]): DraftLine {
  return {
    vehicleRegistration: line.vehicleRegistration,
    carrierId: line.carrierId,
    carrierName: line.carrierName ?? "",
    inboundAt: bangkokDateTimeInput(new Date(line.inboundAt)),
    inboundWeight: String(line.inboundWeight),
    outboundAt: line.outboundAt ? bangkokDateTimeInput(new Date(line.outboundAt)) : "",
    outboundWeight: String(line.outboundWeight),
  };
}

function normalizePlate(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("th");
}

function toIso(value: string) {
  return bangkokDateTimeInputToIso(value);
}

function carrierReference(carrierId: string) {
  return carrierId.slice(-8);
}

export function ExportVehicleWeighBillFormModal({
  locationName,
  details,
  online,
  rubberOptions,
  carriers,
  optionsLoading,
  optionsError,
  onSubmit,
  onClose,
}: {
  locationName: string;
  details: WexDetails | null;
  online: boolean;
  rubberOptions: WexRubberExportOption[];
  carriers: WexCarrierOption[];
  optionsLoading: boolean;
  optionsError: string | null;
  onSubmit: (payload: ExportVehicleWeighBillPayload) => Promise<void>;
  onClose: () => void;
}) {
  const isEditing = Boolean(details);
  const [lines, setLines] = useState<DraftLine[]>(() => (
    details?.lines.map(detailLine) ?? [emptyLine(initialWexTruckInboundAt())]
  ));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (
    details?.rubberExports.map((item) => item.rubberExportId) ?? []
  ));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [carrierListboxIndex, setCarrierListboxIndex] = useState<number | null>(null);
  const [activeCarrierIndex, setActiveCarrierIndex] = useState(0);
  const formId = useId();

  useEffect(() => {
    setLines(details?.lines.map(detailLine) ?? [emptyLine(initialWexTruckInboundAt())]);
    setSelectedIds(details?.rubberExports.map((item) => item.rubberExportId) ?? []);
    setError(null);
    setCarrierListboxIndex(null);
    setActiveCarrierIndex(0);
  }, [details]);

  const lineNetWeights = useMemo(() => lines.map((line) => {
    const inbound = Number(line.inboundWeight);
    const outbound = Number(line.outboundWeight);
    return Number.isFinite(inbound) && Number.isFinite(outbound) && outbound > inbound
      ? outbound - inbound
      : 0;
  }), [lines]);
  const weighingComplete = useMemo(() => lines.every((line) => {
    const inboundAt = toIso(line.inboundAt);
    const outboundAt = toIso(line.outboundAt);
    const inboundWeight = Number(line.inboundWeight);
    const outboundWeight = Number(line.outboundWeight);
    return Boolean(
      inboundAt
      && outboundAt
      && Number.isFinite(inboundWeight)
      && Number.isFinite(outboundWeight)
      && outboundWeight > inboundWeight
      && Date.parse(outboundAt as string) > Date.parse(inboundAt as string)
    );
  }), [lines]);
  const vehicleNetWeight = lineNetWeights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  const selectedExports = rubberOptions.filter((option) => selectedIds.includes(option.rubberExportId));
  const reservedRubberWeight = selectedExports.reduce((sum, option) => sum + option.currentWeight, 0);
  const remainingWeight = vehicleNetWeight - reservedRubberWeight;

  useEffect(() => {
    if (!weighingComplete && selectedIds.length > 0) setSelectedIds([]);
  }, [selectedIds.length, weighingComplete]);

  function updateLine(index: number, next: Partial<DraftLine>) {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...next } : line
    )));
  }

  function addTrailer() {
    const inboundAt = currentBangkokDateTimeNotBefore(lines[0].inboundAt);
    if (!inboundAt) {
      setError("เวลาเข้ารถบรรทุกต้องไม่เป็นอนาคตก่อนเพิ่มหางพ่วง");
      return;
    }
    setError(null);
    setLines((current) => current.length < 2
      ? [...current, emptyLine(inboundAt)]
      : current);
  }

  function updateOutboundWeight(index: number, outboundWeight: string) {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (Number(outboundWeight) <= 0) return { ...line, outboundWeight, outboundAt: "" };
      if (Number(line.outboundWeight) > 0 && line.outboundAt) return { ...line, outboundWeight };
      const outboundAt = currentBangkokDateTimeAfter([line.inboundAt]);
      const outboundMillis = bangkokDateTimeInputToMillis(outboundAt);
      const precedingCrossLineMillis = bangkokDateTimeInputToMillis(
        index === 0 ? current[1]?.inboundAt ?? "" : current[0].outboundAt,
      );
      const crossLineOrderValid = index === 0 && !current[1]
        ? true
        : outboundMillis !== null
          && precedingCrossLineMillis !== null
          && outboundMillis >= precedingCrossLineMillis;
      return {
        ...line,
        outboundWeight,
        outboundAt: crossLineOrderValid ? outboundAt : "",
      };
    }));
  }

  function clearZeroWeight(index: number, field: "inboundWeight" | "outboundWeight") {
    if (Number(lines[index][field]) === 0) updateLine(index, { [field]: "" });
  }

  function restoreBlankWeight(index: number, field: "inboundWeight" | "outboundWeight") {
    if (!lines[index][field].trim()) updateLine(index, { [field]: "0" });
  }

  function toggleExport(rubberExportId: string) {
    setSelectedIds((current) => current.includes(rubberExportId)
      ? current.filter((id) => id !== rubberExportId)
      : [...current, rubberExportId]);
  }

  function updateCarrierText(index: number, value: string) {
    updateLine(index, { carrierId: null, carrierName: value });
    setCarrierListboxIndex(index);
    setActiveCarrierIndex(0);
  }

  function selectCarrier(index: number, carrier: WexCarrierOption) {
    updateLine(index, { carrierId: carrier.carrierId, carrierName: carrier.carrierName });
    setCarrierListboxIndex(null);
    setActiveCarrierIndex(0);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || saving) return;
    const normalizedLines: ExportVehicleWeighBillLineInput[] = [];
    const seenPlates = new Set<string>();
    const sharedCarrierName = lines[0].carrierName.trim();
    const selectedCarrier = lines[0].carrierId
      ? carriers.find((carrier) => carrier.carrierId === lines[0].carrierId)
      : null;
    const selectedCarrierIsCurrent = selectedCarrier?.carrierName === sharedCarrierName;
    const sharedCarrierId = selectedCarrierIsCurrent ? selectedCarrier.carrierId : null;
    if (!isEditing && lines.length === 2 && Number(lines[1].outboundWeight) > 0 && Number(lines[0].outboundWeight) === 0) {
      setError("ต้องชั่งออกรถบรรทุกก่อนหางพ่วง");
      return;
    }
    if (!isEditing && lines.length === 2) {
      const truckInboundMillis = bangkokDateTimeInputToMillis(lines[0].inboundAt);
      const trailerInboundMillis = bangkokDateTimeInputToMillis(lines[1].inboundAt);
      const truckOutboundMillis = bangkokDateTimeInputToMillis(lines[0].outboundAt);
      const trailerOutboundMillis = bangkokDateTimeInputToMillis(lines[1].outboundAt);
      if (truckInboundMillis !== null && trailerInboundMillis !== null && trailerInboundMillis < truckInboundMillis) {
        setError("เวลาเข้าหางพ่วงต้องไม่ก่อนเวลาเข้ารถบรรทุก");
        return;
      }
      if (truckOutboundMillis !== null && trailerInboundMillis !== null && truckOutboundMillis < trailerInboundMillis) {
        setError("ต้องบันทึกเวลาเข้าหางพ่วงก่อนชั่งออกรถบรรทุก");
        return;
      }
      if (trailerOutboundMillis !== null && truckOutboundMillis !== null && trailerOutboundMillis < truckOutboundMillis) {
        setError("เวลาออกหางพ่วงต้องไม่ก่อนเวลาออกรถบรรทุก");
        return;
      }
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const vehicleRole = exportVehicleRoleLabel(index + 1);
      const vehicleRegistration = normalizePlate(line.vehicleRegistration);
      const inboundWeight = Number(line.inboundWeight);
      const outboundWeight = Number(line.outboundWeight);
      const inboundAt = toIso(line.inboundAt);
      const outboundAt = outboundWeight === 0 ? null : toIso(line.outboundAt);
      if (!vehicleRegistration) {
        setError(`กรุณากรอกทะเบียน${vehicleRole}`);
        return;
      }
      if (seenPlates.has(vehicleRegistration)) {
        setError("ทะเบียนรถในบิลเดียวกันต้องไม่ซ้ำกัน");
        return;
      }
      seenPlates.add(vehicleRegistration);
      if (!inboundAt) {
        setError(`กรุณาระบุเวลาเข้าของ${vehicleRole}`);
        return;
      }
      if (!line.inboundWeight.trim() || !Number.isFinite(inboundWeight) || inboundWeight <= 0) {
        setError(`น้ำหนักขาเข้าของ${vehicleRole}ต้องมากกว่า 0`);
        return;
      }
      if (!line.outboundWeight.trim() || !Number.isFinite(outboundWeight) || outboundWeight < 0) {
        setError(`น้ำหนักขาออกของ${vehicleRole}ต้องเป็น 0 หรือมากกว่าน้ำหนักขาเข้า`);
        return;
      }
      if (outboundWeight > 0 && (!outboundAt || outboundWeight <= inboundWeight)) {
        setError(`เมื่อชั่งออกแล้ว กรุณาระบุเวลาออกและน้ำหนักขาออกให้มากกว่าน้ำหนักขาเข้าของ${vehicleRole}`);
        return;
      }
      if (outboundAt && Date.parse(outboundAt) <= Date.parse(inboundAt)) {
        setError(`เวลาออกของ${vehicleRole}ต้องหลังเวลาเข้า`);
        return;
      }
      normalizedLines.push({
        vehicleRegistration,
        carrierId: sharedCarrierId,
        carrierName: sharedCarrierName || null,
        inboundAt,
        inboundWeight,
        outboundAt,
        outboundWeight,
      });
    }
    if (!weighingComplete && selectedIds.length > 0) {
      setError("ต้องชั่งออกรถทุกคันก่อนเลือกรายการ REX");
      return;
    }
    if (reservedRubberWeight > vehicleNetWeight) {
      setError("น้ำหนัก REX ที่เลือกต้องไม่เกินน้ำหนักสุทธิรถรวม");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({ lines: normalizedLines, rubberExportIds: selectedIds });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "บันทึกบิลรถส่งออกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isEditing ? `แก้ไข ${details?.wexNo}` : "สร้างบิลรถส่งออก"}
      subtitle={`${locationName} · ใช้งานได้เมื่อออนไลน์เท่านั้น · รถบรรทุก 1 คัน และหางพ่วงไม่บังคับ`}
      onClose={onClose}
      closeDisabled={saving}
      closeOnEscape
      nativeModal
      renderInPortal
      size="wide"
      mobileFullScreen
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-5" aria-busy={saving}>
        {!online && (
          <p role="alert" className="rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
            บิลรถส่งออกสร้างหรือแก้ไขได้เมื่อออนไลน์เท่านั้น
          </p>
        )}
        {error && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

        <section aria-labelledby="wex-vehicle-lines-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="wex-vehicle-lines-title" className="font-bold text-ink">รายการชั่งรถ</h3>
              <p className="text-pretty text-sm text-ink/60">กรอกเวลาเข้ารถบรรทุกเพียงค่าเดียว ระบบบันทึกเวลาอื่นตามเวลาจริง; ระหว่างรอชั่งออกให้ใช้น้ำหนักขาออก 0</p>
            </div>
            {lines.length < 2 && (
              <button type="button" onClick={addTrailer} disabled={Number(lines[0].outboundWeight) > 0} title={Number(lines[0].outboundWeight) > 0 ? "เพิ่มหางพ่วงก่อนชั่งออกรถบรรทุก" : undefined} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                <Plus size={16} aria-hidden="true" /> เพิ่มหางพ่วง
              </button>
            )}
          </div>
          {lines.map((line, index) => {
            const netWeight = lineNetWeights[index];
            const vehicleRole = exportVehicleRoleLabel(index + 1);
            const matchingCarriers = carriers.filter((carrier) => (
              carrier.carrierName.toLocaleLowerCase("th").includes(line.carrierName.trim().toLocaleLowerCase("th"))
            ));
            const isCarrierListboxOpen = carrierListboxIndex === index;
            const carrierListboxId = `${formId}-carrier-options-${index}`;
            const activeCarrier = matchingCarriers[activeCarrierIndex];
            return (
              <fieldset key={index} className="rounded-lg border border-black/10 bg-field/50 p-3">
                <legend className="px-1 text-sm font-bold text-ink">{vehicleRole}</legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <label className="block lg:col-span-1"><span className="mb-1 block text-sm font-semibold text-ink/70">ทะเบียนรถ</span><input required aria-label={`ทะเบียน${vehicleRole}`} value={line.vehicleRegistration} onChange={(event) => updateLine(index, { vehicleRegistration: event.target.value })} className="focus-ring h-11 w-full rounded-md border border-black/15 bg-white px-3" /></label>
                  {index === 0 ? <label className="relative block"><span className="mb-1 block text-sm font-semibold text-ink/70">ผู้ขนส่ง (ไม่บังคับ)</span><input role="combobox" aria-label={`ผู้ขนส่ง${vehicleRole}`} aria-autocomplete="list" aria-expanded={isCarrierListboxOpen && matchingCarriers.length > 0} aria-controls={isCarrierListboxOpen ? carrierListboxId : undefined} aria-activedescendant={isCarrierListboxOpen && activeCarrier ? `${carrierListboxId}-${activeCarrier.carrierId}` : undefined} value={line.carrierName} onFocus={() => { setCarrierListboxIndex(index); setActiveCarrierIndex(0); }} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setCarrierListboxIndex(null); }} onChange={(event) => updateCarrierText(index, event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && matchingCarriers.length > 0) { event.preventDefault(); setCarrierListboxIndex(index); setActiveCarrierIndex((current) => (current + 1) % matchingCarriers.length); } else if (event.key === "ArrowUp" && matchingCarriers.length > 0) { event.preventDefault(); setCarrierListboxIndex(index); setActiveCarrierIndex((current) => (current - 1 + matchingCarriers.length) % matchingCarriers.length); } else if (event.key === "Enter" && isCarrierListboxOpen && activeCarrier) { event.preventDefault(); selectCarrier(index, activeCarrier); } else if (event.key === "Escape") { setCarrierListboxIndex(null); } }} autoComplete="off" placeholder="เลือกจากรายชื่อหรือพิมพ์เอง" className="focus-ring h-11 w-full rounded-md border border-black/15 bg-white px-3" />{isCarrierListboxOpen && matchingCarriers.length > 0 && <ul id={carrierListboxId} role="listbox" aria-label={`รายชื่อผู้ขนส่ง${vehicleRole}`} className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-black/15 bg-white py-1 shadow-lg">{matchingCarriers.map((carrier, carrierIndex) => <li key={carrier.carrierId} id={`${carrierListboxId}-${carrier.carrierId}`} role="option" aria-selected={line.carrierId === carrier.carrierId} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCarrier(index, carrier)} className={`cursor-pointer px-3 py-2 text-sm ${carrierIndex === activeCarrierIndex ? "bg-field text-ink" : "text-ink hover:bg-field"}`}><span className="block font-semibold">{carrier.carrierName}</span><span className="block text-xs text-ink/60">รหัส {carrierReference(carrier.carrierId)}</span></li>)}</ul>}</label> : <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">ผู้ขนส่ง (ตามรถบรรทุก)</span><input aria-label={`ผู้ขนส่ง${vehicleRole}`} value={lines[0].carrierName} readOnly className="focus-ring h-11 w-full rounded-md border border-black/15 bg-field px-3 text-ink/70" /></label>}
                  <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">เวลาเข้า</span><input required aria-label={`เวลาเข้า${vehicleRole}`} type="datetime-local" step="1" value={line.inboundAt} readOnly={index > 0} onChange={index === 0 ? (event) => updateLine(index, { inboundAt: event.target.value }) : undefined} className={cn("focus-ring h-11 w-full rounded-md border border-black/15 px-3 tabular-nums", index > 0 ? "bg-field text-ink/70" : "bg-white")} /></label>
                  <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">น้ำหนักขาเข้า</span><input required aria-label={`น้ำหนักขาเข้า${vehicleRole}`} type="number" min="0" step="0.01" value={line.inboundWeight} onFocus={() => clearZeroWeight(index, "inboundWeight")} onBlur={() => restoreBlankWeight(index, "inboundWeight")} onChange={(event) => updateLine(index, { inboundWeight: event.target.value })} className="focus-ring h-11 w-full rounded-md border border-black/15 bg-white px-3 tabular-nums" /></label>
                  <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">เวลาออก (เมื่อชั่งออก)</span><input required={Number(line.outboundWeight) > 0} aria-label={`เวลาออก${vehicleRole}`} type="datetime-local" step="1" value={line.outboundAt} readOnly className="focus-ring h-11 w-full rounded-md border border-black/15 bg-field px-3 text-ink/70 tabular-nums" /></label>
                  <div className="flex gap-2"><label className="block min-w-0 flex-1"><span className="mb-1 block text-sm font-semibold text-ink/70">น้ำหนักขาออก</span><input required aria-label={`น้ำหนักขาออก${vehicleRole}`} type="number" min="0" step="0.01" value={line.outboundWeight} onFocus={() => clearZeroWeight(index, "outboundWeight")} onBlur={() => restoreBlankWeight(index, "outboundWeight")} onChange={(event) => updateOutboundWeight(index, event.target.value)} className="focus-ring h-11 w-full rounded-md border border-black/15 bg-white px-3 tabular-nums" /></label>{index === 1 && <button type="button" aria-label="ลบหางพ่วง" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="focus-ring mt-6 inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-actionSecondary text-white"><Minus size={16} aria-hidden="true" /></button>}</div>
                </div>
                <p className={netWeight > 0 ? "mt-2 text-pretty text-sm font-semibold text-leaf" : "mt-2 text-pretty text-sm font-semibold text-ink/55"}>{Number(line.outboundWeight) === 0 ? "สถานะ: รอชั่งออก" : `น้ำหนักสุทธิ${vehicleRole}: ${formatExportVehicleWeighBillNumber(netWeight)} กก.`}</p>
              </fieldset>
            );
          })}
        </section>

        <section aria-labelledby="wex-rex-title" className="space-y-3">
          <div><h3 id="wex-rex-title" className="font-bold text-ink">จองรายการ REX ที่ขายออกแล้ว</h3><p className="text-sm text-ink/60">เลือกได้ 0 รายการขึ้นไปหลังชั่งออกรถครบทุกคัน; ระบบ Server ตรวจสิทธิ์ สาขา การจองซ้ำ และน้ำหนักอีกครั้ง</p></div>
          {!weighingComplete && <p role="status" className="rounded-md bg-amber/15 px-3 py-2 text-sm font-semibold text-amber-900">รอชั่งออก — ยังไม่สามารถเลือกหรือจอง REX ได้</p>}
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md bg-field p-3"><p className="text-xs text-ink/60">น้ำหนักสุทธิรถรวม</p><p className="font-bold tabular-nums">{formatExportVehicleWeighBillNumber(vehicleNetWeight)} กก.</p></div><div className="rounded-md bg-field p-3"><p className="text-xs text-ink/60">น้ำหนัก REX ที่เลือก</p><p className="font-bold tabular-nums">{formatExportVehicleWeighBillNumber(reservedRubberWeight)} กก.</p></div><div className={remainingWeight < 0 ? "rounded-md bg-red-50 p-3" : "rounded-md bg-mint/40 p-3"}><p className="text-xs text-ink/60">น้ำหนักคงเหลือ</p><p className="font-bold tabular-nums">{formatExportVehicleWeighBillNumber(remainingWeight)} กก.</p></div></div>
          {optionsLoading ? <p role="status" className="text-sm font-semibold text-ink/60">กำลังโหลดรายการ REX ที่เลือกได้...</p> : optionsError ? <p role="alert" className="text-sm font-semibold text-red-700">{optionsError}</p> : rubberOptions.length === 0 ? <p className="rounded-md bg-field px-4 py-3 text-sm text-ink/60">ไม่มี REX ที่ขายออกและพร้อมจองในสาขานี้</p> : <fieldset className="overflow-hidden rounded-md border border-black/10"><legend className="sr-only">เลือกรายการ REX</legend><div className="max-h-64 overflow-y-auto divide-y divide-black/5">{rubberOptions.map((option) => <label key={option.rubberExportId} className={`flex items-center justify-between gap-3 bg-white px-3 py-3 ${weighingComplete ? "cursor-pointer hover:bg-field" : "cursor-not-allowed opacity-60"}`}><span className="flex min-w-0 items-center gap-3"><input type="checkbox" aria-label={`เลือก ${option.exportNo}`} disabled={!weighingComplete} checked={selectedIds.includes(option.rubberExportId)} onChange={() => toggleExport(option.rubberExportId)} className="focus-ring size-4 accent-leaf" /><span className="font-semibold text-ink">{option.exportNo}</span></span><span className="shrink-0 tabular-nums text-sm text-ink/70">{formatExportVehicleWeighBillNumber(option.currentWeight)} กก.</span></label>)}</div></fieldset>}
        </section>

        <div className="modal-actions flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white disabled:opacity-50">ยกเลิก</button><button type="submit" disabled={!online || saving || optionsLoading} title={!online ? "บันทึก WEX ได้เมื่อออนไลน์เท่านั้น" : undefined} className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{isEditing ? "บันทึกการแก้ไข" : "บันทึก WEX"}</button></div>
      </form>
    </ModalShell>
  );
}
