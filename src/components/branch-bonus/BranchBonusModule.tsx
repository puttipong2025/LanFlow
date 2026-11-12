"use client";
import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { canManageSystemFeatures } from "@/lib/permissions";
import { withBonusLeaveGuard, BONUS_LEAVE_EVENT } from "@/lib/branch-bonus/navigation";
import { useBranchBonuses } from "@/hooks/useBranchBonuses";
import type { Location, Profile } from "@/types";
import type { BonusBatchResult, BonusDetail, BonusListRow } from "@/types/branch-bonus";
import { readBonusBatchIntent } from "@/lib/branch-bonus/batch";
import { BonusBatchForm } from "./BonusBatchForm";
import { BonusSummary } from "./BonusSummary";
import { BonusSources } from "./BonusSources";
import { BonusExports } from "./BonusExports";
import { BonusChanges } from "./BonusChanges";
import { bonusNumber, primaryButton, secondaryButton } from "./bonus-display";

export function BranchBonusModule({ selectedLocation, profile, online, onOpenSource }: {
  selectedLocation: Location; profile: Profile; online: boolean; onOpenSource?: (id:string)=>void;
}) {
  const api=useBranchBonuses(selectedLocation.id,profile.id,online&&canManageSystemFeatures(profile));
  const [mode,setMode]=useState<"list"|"create"|"detail"|"batch">("list"),[detail,setDetail]=useState<BonusDetail|null>(null);
  const [result,setResult]=useState<BonusBatchResult|null>(null),[deletion,setDeletion]=useState<BonusListRow|BonusDetail|null>(null);
  const [opening,setOpening]=useState(false);
  const flight=useRef(false),createFlight=useRef(false);
  const busy=api.working||opening;
  useEffect(()=>{
    const handler=(event:Event)=>{if(flight.current)event.preventDefault();};
    window.addEventListener(BONUS_LEAVE_EVENT,handler);return()=>window.removeEventListener(BONUS_LEAVE_EVENT,handler);
  },[]);
  async function open(id:string){
    if(flight.current||busy)return;flight.current=true;setOpening(true);api.setError(null);
    try{setDetail(await api.detail(id));setMode("detail");}
    catch(caught){api.setError(caught instanceof Error?caught.message:"เปิดผลไม่สำเร็จ");}
    finally{flight.current=false;setOpening(false);}
  }
  function back(){withBonusLeaveGuard(()=>{setMode("list");setDetail(null);setResult(null);createFlight.current=false;void api.load("list");});}
  if(!canManageSystemFeatures(profile))return <p role="alert" className="text-pretty">ไม่มีสิทธิ์จัดการโบนัส</p>;
  if(!online)return <p role="status" className="text-pretty">โบนัสใช้ได้เมื่อออนไลน์ กรุณาเชื่อมต่อแล้วเปิดเมนูอีกครั้ง</p>;
  return <section aria-label="โบนัสสาขา" className="space-y-5 text-ink">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-balance text-2xl font-bold">โบนัสสาขา</h2><p className="mt-1 text-pretty text-sm text-ink/60">{selectedLocation.name} · ประเมินยอดรวมให้เจ้าของแบ่งแก่พนักงาน</p></div>
      {mode==="list"?<button type="button" className={primaryButton} disabled={busy||api.loading!==null||api.pending!==null} onClick={()=>{if(createFlight.current)return;createFlight.current=true;setMode("create");}}>สร้างโบนัส</button>:<button type="button" className={secondaryButton} disabled={busy} onClick={back}>กลับรายการโบนัส</button>}
    </header>
    {api.error&&<p role="alert" className="text-pretty rounded-lg bg-sand p-3 text-sm text-clay">{api.error}</p>}
    {api.pending&&<div className="space-y-3 rounded-lg bg-sand p-4"><p className="text-pretty">มีคำขอยืนยันแบบเดิมที่ยังไม่ทราบผล ตรวจคำขอเดิมก่อนเริ่มใหม่</p><button type="button" disabled={busy} className={primaryButton} onClick={()=>void api.retryLegacy().then(saved=>{if(saved){setDetail(saved);setMode("detail");}})}>ตรวจผลคำขอเดิม</button></div>}
    {mode==="list"&&<div className="space-y-3">
      <button type="button" className={secondaryButton} disabled={busy||api.loading!==null} onClick={()=>void api.load("list")}>โหลดรายการโบนัสใหม่</button>
      {readBonusBatchIntent(profile.id,selectedLocation.id)&&<p className="text-pretty rounded-lg bg-sand p-3 text-sm">มีคำขอทั้งชุดที่ยังไม่ทราบผล กดสร้างโบนัสเพื่อเปิดตรวจคำขอเดิม</p>}
      {api.loading&&<p role="status" className="text-pretty">กำลังโหลดโบนัส…</p>}
      {!api.loading&&api.list.rows.length===0&&<p className="text-pretty rounded-lg bg-sand p-4">ยังไม่มีผลโบนัส กดสร้างโบนัสเพื่อประเมินสาขานี้</p>}
      {api.list.rows.map(row=><article key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-black/10 bg-white p-4"><button type="button" className="focus-ring min-w-0 flex-1 rounded text-left font-semibold tabular-nums" disabled={busy} onClick={()=>void open(row.id)}>{row.periodStart} ถึง {row.periodEnd}</button><strong className="tabular-nums">{bonusNumber(row.finalAmount)} บาท</strong><button type="button" className={secondaryButton} disabled={busy||!!api.pending} onClick={()=>setDeletion(row)}>ลบผล {row.periodStart}</button></article>)}
      {api.list.hasMore&&<button type="button" className={secondaryButton} disabled={busy||api.loading!==null} onClick={()=>void api.load("list",true,api.list.rows.at(-1))}>โหลดโบนัสเพิ่ม</button>}
    </div>}
    {mode==="create"&&<BonusBatchForm locationId={selectedLocation.id} ownerId={profile.id} openSource={onOpenSource} saved={batch=>{setResult(batch);setMode("batch");createFlight.current=false;}}/>}
    {mode==="batch"&&result&&<div className="space-y-3"><h3 className="text-balance text-lg font-semibold">ผลคำขอยืนยันโบนัสทุกช่วง</h3>{result.deletedIds.length>0&&<p role="status" className="text-pretty text-sm text-clay">มีผลที่ถูกลบแล้ว {result.deletedIds.length} ช่วง ระบบไม่สร้างผลที่ลบกลับมา</p>}{result.results.map(row=><button key={row.id} type="button" className={secondaryButton} disabled={busy} onClick={()=>void open(row.id)}>{row.periodStart} ถึง {row.periodEnd} · {bonusNumber(row.finalAmount)} บาท · เปิดผล</button>)}</div>}
    {mode==="detail"&&detail&&<div className="space-y-4"><h3 className="text-balance text-lg font-semibold">ผลโบนัสที่ยืนยันแล้ว</h3><BonusSummary preview={detail} finalAmount={detail.finalAmount}/><details className="rounded-lg border border-black/10 p-4"><summary className="focus-ring min-h-11 font-semibold">สูตรและที่มาของผลโบนัส</summary><p className="text-pretty text-sm">{detail.formulaVersion}</p><BonusExports rows={detail.exports} selected={detail.input.exportIds}/><BonusSources preview={detail} input={detail.input} saved load={(section,offset,signal)=>api.sources(detail.input,section,offset,detail.id,signal)}/><BonusChanges saved rows={detail.changes} total={detail.changeCount} fingerprint={detail.sourceFingerprint} load={(offset,signal)=>api.changeSources(detail.input,offset,detail.id,signal)}/></details><button type="button" className={secondaryButton} disabled={busy} onClick={()=>setDeletion(detail)}>ลบผลโบนัสนี้</button></div>}
    <AlertDialog open={deletion!==null} title="ลบผลโบนัส" description={deletion?`${deletion.periodStart} ถึง ${deletion.periodEnd} · ลบแล้วปลดเฉพาะล็อกโบนัสของ REX ที่เกี่ยวข้อง`:""} confirmLabel="ลบผลโบนัส" busy={api.working} onCancel={()=>{if(!api.working)setDeletion(null);}} onConfirm={()=>{if(deletion)void api.remove(deletion.id).then(ok=>{if(ok){setDeletion(null);setMode("list");setDetail(null);void api.load("list");}});}}/>
  </section>;
}
