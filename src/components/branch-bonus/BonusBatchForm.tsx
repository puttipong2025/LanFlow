"use client";
import { useEffect, useRef, useState } from "react";
import { authFetch, assertApiResponse, ApiResponseError } from "@/lib/auth-fetch";
import { fetchBonus } from "@/hooks/useBranchBonuses";
import { newBonusSettings } from "@/lib/branch-bonus/input";
import { clearBonusBatchIntent, parseBonusBatch, readBonusBatchIntent, saveBonusBatchIntent } from "@/lib/branch-bonus/batch";
import { BONUS_LEAVE_EVENT } from "@/lib/branch-bonus/navigation";
import { cn } from "@/lib/cn";
import type { BonusBatchIntent, BonusBatchPart, BonusBatchPreview, BonusBatchResult, BonusDetail, BonusReview, BonusSettings as Settings } from "@/types/branch-bonus";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { ModalShell } from "@/components/shared/ModalShell";
import { BonusRequired } from "./BonusRequired";
import { BonusSettings } from "./BonusSettings";
import { BonusSources } from "./BonusSources";
import { BonusChanges } from "./BonusChanges";
import { BonusSummary } from "./BonusSummary";
import { BonusExports } from "./BonusExports";
import { BonusDecimalField } from "./BonusDecimalField";
import { primaryButton, secondaryButton } from "./bonus-display";

const steps=["ตรวจ REX","ตรวจข้อมูล","ตั้งเป้าและอัตรา","ตรวจและยืนยัน"];
export function BonusBatchForm({ locationId, ownerId, saved, openSource }: {
  locationId: string; ownerId: string; saved: (result: BonusBatchResult) => void; openSource?: (id: string) => void;
}) {
  const [review,setReview]=useState<BonusReview|null>(null),[parts,setParts]=useState<BonusBatchPart[]>([]);
  const [step,setStep]=useState(1),[active,setActive]=useState("");
  const [loading,setLoading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState<string|null>(null);
  const [calculation,setCalculation]=useState<{key:string; data:BonusBatchPreview}|null>(null),[previewing,setPreviewing]=useState(false);
  const [pending,setPending]=useState<BonusBatchIntent|null>(()=>readBonusBatchIntent(ownerId,locationId));
  const [blocked,setBlocked]=useState(false),[old,setOld]=useState<BonusDetail|null>(null);
  const [leave,setLeave]=useState<{proceed:()=>void}|null>(null);
  const flight=useRef(false),leaving=useRef(false),loadFlight=useRef(false);
  const previewFlight=useRef<{key:string;promise:Promise<BonusBatchPreview>}|null>(null);
  const key=JSON.stringify(parts.map(p=>({key:p.key,input:p.input})));
  const preview=calculation?.key===key?calculation.data:null;
  const part=parts.find(p=>p.key===active),period=review?.periods.find(p=>p.key===active);
  const current=preview?.periods.find(p=>p.key===active)?.preview??null;
  const canConfirm=!!preview&&parts.length>0&&preview.periods.length===parts.length&&preview.periods.every(p=>p.preview.canConfirm);

  function applyReview(data:BonusReview){
    setReview(data);setParts(previous=>data.periods.map(p=>{
      const existing=previous.find(x=>x.key===p.key&&JSON.stringify(x.input.exportIds)===JSON.stringify(p.exportIds));
      return existing?{...existing,finalAmount:null}:{key:p.key,input:{...newBonusSettings(),exportIds:p.exportIds}};
    }));setActive(previous=>data.periods.some(p=>p.key===previous)?previous:data.periods[0]?.key??"");
    setCalculation(null);setStep(1);
  }

  async function reload(signal?:AbortSignal) {
    if((loadFlight.current&&!signal)||flight.current||pending)return;
    loadFlight.current=true;setLoading(true);setError(null);
    try {
      const response=await authFetch(`/api/lanflow/branch-bonuses?${new URLSearchParams({locationId,view:"review"})}`,{cache:"no-store",signal});
      await assertApiResponse(response);const data:BonusReview=await response.json();if(signal?.aborted)return;
      applyReview(data);
    }catch(caught){if(!signal?.aborted)setError(caught instanceof Error?caught.message:"โหลด REX ไม่สำเร็จ");}
    finally{loadFlight.current=false;if(!signal?.aborted)setLoading(false);}
  }
  useEffect(()=>{const controller=new AbortController();void reload(controller.signal);return()=>controller.abort();
    // The parent keys this form by branch/owner; refresh is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(!review||review.blockedCount||!parts.length||pending||!parseBonusBatch(parts)) {setPreviewing(false);return;}
    const controller=new AbortController();setPreviewing(true);
    const promise=new Promise<BonusBatchPreview>((resolve,reject)=>{
      const timer=window.setTimeout(()=>{
        void fetchBonus<BonusBatchPreview>({action:"previewBatch",locationId,review:review.fingerprint,periods:parts.map(p=>({key:p.key,input:p.input}))},controller.signal).then(resolve,reject);
      },250);
      controller.signal.addEventListener("abort",()=>{window.clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));},{once:true});
    });
    previewFlight.current={key,promise};
    void promise
        .then(data=>{if(!controller.signal.aborted)setCalculation({key,data});})
        .catch(caught=>{if(!controller.signal.aborted){previewFlight.current=null;setError(caught instanceof Error?caught.message:"คำนวณไม่สำเร็จ");}})
        .finally(()=>{if(!controller.signal.aborted)setPreviewing(false);});
    return()=>{previewFlight.current=null;controller.abort();};
    // Final amounts don't change the calculated metrics or source fingerprints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,review,locationId,pending]);
  useEffect(()=>{
    const handler=(event:Event)=>{
      if(leaving.current)return;event.preventDefault();
      if(!flight.current)setLeave((event as CustomEvent<{proceed:()=>void}>).detail);
    };
    const unload=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener(BONUS_LEAVE_EVENT,handler);window.addEventListener("beforeunload",unload);
    return()=>{window.removeEventListener(BONUS_LEAVE_EVENT,handler);window.removeEventListener("beforeunload",unload);};
  },[]);
  function change(input:Settings){if(flight.current||pending)return;setParts(all=>all.map(p=>p.key===active?{key:p.key,input,finalAmount:null}:p));setError(null);}
  async function next(){
    if(flight.current||pending)return;flight.current=true;setWorking(true);setError(null);
    try{
      const response=await authFetch(`/api/lanflow/branch-bonuses?${new URLSearchParams({locationId,view:"review"})}`,{cache:"no-store"});
      await assertApiResponse(response);const latest:BonusReview=await response.json();
      if(latest.fingerprint!==review?.fingerprint){applyReview(latest);if(latest.blockedCount)setBlocked(true);else setError("ชุดข้อมูลเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุดก่อนถัดไป");return;}
      if(latest.blockedCount){setStep(1);setBlocked(true);return;}
      let calculated=preview;
      if(!calculated){
        const request=previewFlight.current;
        const data=await (request?.key===key?request.promise:fetchBonus<BonusBatchPreview>({action:"previewBatch",locationId,review:latest.fingerprint,periods:parts.map(p=>({key:p.key,input:p.input}))}));
        setCalculation({key,data});
        calculated=data;
      }
      if(step===3&&!calculated.periods.every(p=>p.preview.canConfirm)){setError("กรุณาตรวจเป้าและอัตราให้ครบทุกช่วงก่อนถัดไป");return;}
      setStep(n=>Math.min(4,n+1));
    }catch(caught){setError(caught instanceof Error?caught.message:"ตรวจรายการล่าสุดไม่สำเร็จ");}
    finally{flight.current=false;setWorking(false);}
  }
  async function confirm(retry=false){
    if(flight.current||(!retry&&(!review||!canConfirm||previewing)))return;
    flight.current=true;setWorking(true);setError(null);
    try{
      const intent=retry?readBonusBatchIntent(ownerId,locationId):{
        version:1 as const,id:crypto.randomUUID(),ownerId,locationId,review:review!.fingerprint,
        periods:parts.map(p=>({...p,expected:preview!.periods.find(x=>x.key===p.key)!.preview.sourceFingerprint,finalAmount:p.finalAmount??null})),
      };
      if(!intent)throw new Error("ไม่พบคำขอเดิม กรุณาตรวจใหม่");
      saveBonusBatchIntent(intent);setPending(intent);
      const result=await fetchBonus<BonusBatchResult>({...intent,action:"confirmBatch"});
      clearBonusBatchIntent(ownerId,locationId);setPending(null);leaving.current=true;saved(result);
    }catch(caught){
      // Temporary auth/transport failures cannot disprove an earlier committed request.
      if(caught instanceof ApiResponseError&&(caught.status===400||caught.status===409)){clearBonusBatchIntent(ownerId,locationId);setPending(null);setCalculation(null);setStep(1);setParts(all=>all.map(p=>({...p,finalAmount:null})));}
      setError(caught instanceof Error?caught.message:"ยังไม่ทราบผล กรุณาตรวจคำขอเดิม");
    }finally{flight.current=false;setWorking(false);}
  }
  async function openOld(id:string){
    if(flight.current)return;flight.current=true;setWorking(true);setError(null);
    try{const response=await authFetch(`/api/lanflow/branch-bonuses?${new URLSearchParams({locationId,id})}`,{cache:"no-store"});await assertApiResponse(response);setOld(await response.json());}
    catch(caught){setError(caught instanceof Error?caught.message:"เปิดผลไม่สำเร็จ");}finally{flight.current=false;setWorking(false);}
  }
  return <div className="space-y-5">
    <ol aria-label="ขั้นตอนประเมินโบนัส" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((label,i)=><li key={label} aria-current={step===i+1?"step":undefined} className={cn("rounded-lg border p-3 text-sm font-semibold",step===i+1?"border-leaf bg-mint/40 text-leaf":"border-black/10 text-ink/50")}>{i+1}. {label}</li>)}</ol>
    {pending&&<div className="space-y-3 rounded-lg bg-sand p-4"><p className="text-pretty">มีคำขอยืนยันทุกช่วงที่ยังไม่ทราบผล ตรวจคำขอเดิมก่อนเริ่มใหม่</p><button type="button" className={primaryButton} disabled={working} onClick={()=>void confirm(true)}>ตรวจผลคำขอเดิมทั้งชุด</button></div>}
    {error&&<p role="alert" className="text-pretty rounded-lg bg-sand p-3 text-sm text-clay">{error}</p>}
    {loading&&<div role="status" className="space-y-3 rounded-lg bg-sand p-4"><div className="h-6 w-1/2 rounded bg-mint"/><div className="h-20 rounded bg-mint/50"/><span className="sr-only">กำลังตรวจ REX ทั้งหมด</span></div>}
    <fieldset disabled={working||loading||pending!==null} className="min-w-0 max-w-5xl space-y-5">
      {step===1&&<><h3 className="text-balance text-lg font-semibold">ตรวจ REX ที่รอทำโบนัส</h3><button type="button" className={secondaryButton} onClick={()=>void reload()}>โหลด REX ใหม่</button>{review&&<BonusRequired review={review} openOld={id=>void openOld(id)} openSource={openSource}/>}</>}
      {review&&<div className="space-y-2 rounded-lg bg-sand p-4"><h3 className="text-balance font-semibold">ช่วงประเมินอัตโนมัติ · {review.periods.length} ช่วง</h3>{review.periods.map(p=><p key={p.key} className="text-pretty text-sm tabular-nums">{p.periodStart} ถึง {p.periodEnd} · {p.periodDays} วัน · REX {p.exportIds.length} ใบ · เป้านับเงิน {p.periodDays} ใบ</p>)}<p className="text-pretty text-xs text-ink/60">รวมทุกวันภายในแต่ละช่วงตามเวลาไทย ไม่รวมวันของโบนัสเดิม</p></div>}
      {(step===2||step===3)&&part&&period&&<><label className="block text-sm font-semibold">ช่วงที่กำลังตรวจ<select className="focus-ring mt-1 h-11 w-full rounded-md border border-black/10 bg-white px-3" value={active} onChange={e=>setActive(e.target.value)}>{review?.periods.map(p=><option key={p.key} value={p.key}>{p.periodStart} ถึง {p.periodEnd}</option>)}</select></label>
        {step===2&&current&&<><BonusSources key={active} preview={current} input={part.input} change={change} load={(section,offset,signal)=>fetchBonus({action:"sources",locationId,input:part.input,section,offset},signal)}/><details className="rounded-lg border border-black/10 p-4"><summary className="focus-ring min-h-11 font-semibold">ตรวจน้ำหนักลดลงรายเที่ยว ({current.exports.length}) · อายุ ณ ตรวจสอบ</summary><BonusExports rows={current.exports} selected={part.input.exportIds}/></details><BonusChanges rows={current.changes} total={current.changeCount} fingerprint={current.sourceFingerprint} load={(offset,signal)=>fetchBonus({action:"sources",locationId,input:part.input,section:"changes",offset},signal)}/></>}
        {step===3&&<BonusSettings key={active} input={part.input} change={change} preview={current}/>}
      </>}
      {step===4&&preview&&parts.map(p=>{const result=preview.periods.find(x=>x.key===p.key)?.preview;return result&&<section key={p.key} className="max-w-3xl space-y-4 rounded-lg border border-black/10 bg-white p-4"><BonusSummary preview={result} finalAmount={p.finalAmount??result.suggestedAmount}/><BonusDecimalField label={`ยอดโบนัสสุดท้าย ${result.periodStart} ถึง ${result.periodEnd} (บาท)`} value={p.finalAmount??result.suggestedAmount} change={finalAmount=>setParts(all=>all.map(x=>x.key===p.key?{...x,finalAmount}:x))}/>{result.issues.map(issue=><p key={issue} role="alert" className="text-pretty text-sm text-clay">{issue}</p>)}</section>;})}
      {previewing&&<p role="status" className="text-pretty text-sm">กำลังคำนวณทุกช่วง…</p>}
      {step===3&&!parseBonusBatch(parts)&&<p role="alert" className="text-pretty text-sm text-clay">ตรวจอัตราและเป้าไม่เกินสองตำแหน่ง สัดส่วนเป็นจำนวนเต็ม และค่าต้องไม่ติดลบ</p>}
      {step===4&&!parseBonusBatch(parts)&&<p role="alert" className="text-pretty text-sm text-clay">ยอดสุดท้ายต้องเป็นตัวเลขระหว่าง 0 ถึง 9,999,999,999.99 บาท</p>}
      <div className="flex flex-wrap justify-between gap-3 border-t border-black/10 pt-4"><button type="button" className={secondaryButton} disabled={step===1} onClick={()=>setStep(n=>n-1)}>ย้อนกลับ</button>
        {step<4?<button type="button" className={primaryButton} disabled={!review?.requiredCount||!parseBonusBatch(parts)||(step===3&&!previewing&&!!preview&&!canConfirm)} onClick={()=>void next()}>{step===1?"ตรวจสอบและถัดไป":"ถัดไป"}</button>:<button type="button" className={primaryButton} disabled={!canConfirm||previewing||!parseBonusBatch(parts)} onClick={()=>void confirm()}>ยืนยันโบนัสทุกช่วง</button>}
      </div>
    </fieldset>
    {working&&<ModalShell title="กำลังโหลดข้อมูลโบนัส" nativeModal size="compact" hideClose closeDisabled onClose={()=>{}}><p role="status" aria-live="polite" className="flex items-center gap-3 text-pretty"><span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-leaf/20 border-t-leaf motion-safe:animate-spin"/>กำลังตรวจสอบและคำนวณข้อมูล กรุณารอสักครู่</p></ModalShell>}
    {blocked&&<AlertDialog open title={`ยังไปต่อไม่ได้ · ต้องแก้ไข ${review?.blockedCount??0} รายการ`} description="ตรวจครบทุกหน้าแล้ว รับทราบแล้วต้องแก้ต้นทางให้ครบก่อน" confirmLabel={null} cancelLabel="รับทราบ" onCancel={()=>setBlocked(false)}><ul className="space-y-3">{review?.rows.filter(r=>r.kind==='required'&&r.issues.length).map(r=><li key={r.id} className="text-sm"><strong>{r.exportNo}</strong>{r.issues.map(i=><p key={i} className="text-pretty text-clay">{i}</p>)}{openSource&&<button type="button" className={secondaryButton} onClick={()=>{setBlocked(false);openSource(r.id);}}>เปิดต้นทาง {r.exportNo}</button>}</li>)}</ul></AlertDialog>}
    {old&&<ModalShell title="ผลโบนัสเดิม" nativeModal onClose={()=>setOld(null)}><BonusSummary preview={old} finalAmount={old.finalAmount}/></ModalShell>}
    <AlertDialog open={leave!==null} title="ออกจากการประเมินโบนัส" description={pending?"คำขอที่ยังไม่ทราบผลจะเก็บไว้ตรวจด้วยรหัสเดิมเมื่อกลับมา":"ค่าประเมินที่ยังไม่ยืนยันจะไม่ถูกเก็บ"} confirmLabel="ออกจากหน้านี้" cancelLabel="ประเมินต่อ" onCancel={()=>setLeave(null)} onConfirm={()=>{leaving.current=true;leave?.proceed();setLeave(null);}}/>
  </div>;
}
