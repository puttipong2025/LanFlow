import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import type { BonusBatchPreview, BonusChange, BonusPreview, BonusReview, BonusSource } from "../src/types/branch-bonus";
import { newBonusSettings } from "../src/lib/branch-bonus/input";

// Execute the real component callbacks with deterministic React scheduling and I/O.
function runtime() {
  const slots: any[] = []; let cursor = 0; let effects: Array<()=>void> = [];
  return {
    react: {
      useState(initial: any) {
        const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==="function"?initial():initial;
        return [slots[i],(value:any)=>{slots[i]=typeof value==="function"?value(slots[i]):value;}];
      },
      useRef(initial:any) { const i=cursor++; return slots[i]??(slots[i]={current:initial}); },
      useId() { const i=cursor++; return slots[i]??(slots[i]=`field-${i}`); },
      useCallback(fn:any,deps:any[]) {
        const i=cursor++,prior=slots[i];
        if(!prior||deps.some((dep,j)=>!Object.is(dep,prior.deps[j]))) slots[i]={deps,value:fn};
        return slots[i].value;
      },
      useEffect(fn:()=>any,deps:any[]) {
        const i=cursor++, prior=slots[i];
        if(!prior||deps.some((dep,j)=>!Object.is(dep,prior.deps[j]))) effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:fn()};});
      },
    },
    render(fn:()=>any) { cursor=0;const tree=fn();const queued=effects;effects=[];queued.forEach(fn=>fn());return tree; },
    close() { for(const slot of slots) slot?.cleanup?.(); },
  };
}
const jsx=(type:any,props:any)=>({type,props});
const jsxRuntime={jsx,jsxs:jsx,Fragment:"fragment"};
function nodes(tree:any):any[] {
  if(Array.isArray(tree))return tree.flatMap(nodes);
  return tree&&typeof tree==="object"&&tree.props?[tree,...nodes(tree.props.children)]:[];
}
const button=(tree:any,name:string)=>nodes(tree).find(n=>n.type==="button"&&n.props.children===name);
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};
}
const Modal=()=>null;
const locationId="b0060000-0000-4000-8000-000000000001";
const review:BonusReview={fingerprint:"b".repeat(32),requiredCount:1,blockedCount:0,rows:[],periods:[{key:"0",exportIds:[locationId],periodStart:"2020-01-01",periodEnd:"2020-01-01",periodDays:1}]};
function preview():BonusBatchPreview {
  return {referenceBranches:[{id:locationId,name:"Own",hasPending:false,included:true},{id:"b0060000-0000-4000-8000-000000000002",name:"Other",hasPending:false,included:true}],periods:[{key:"0",preview:{
    periodStart:"2020-01-01",periodEnd:"2020-01-01",periodDays:1,asOf:"2020-01-01T00:00Z",formulaVersion:"branch-bonus-v2",
    sourceFingerprint:"a",complete:true,overlap:false,gaps:[],exports:[],expenses:[],purchases:[],counts:[],
    sourceCounts:{expenses:0,purchases:0,counts:0},selectedSourceCounts:{expenses:0,purchases:0,counts:0},changes:[],changeCount:0,expenseGroups:[],
    weight:100,expenseTotal:0,purchaseTotal:0,countTotal:0,burdenActual:null,countActual:0,lossActual:10,metrics:[],rate:0,base:0,adjustment:0,suggestedAmount:0,scenarios:[],canConfirm:true,issues:[],
  }}]};
}
function batchHarness() {
  const state=runtime();let response=review, calculations=0;
  const sent:any[]=[];
  let pending=deferred<BonusBatchPreview>();
  const dependencies:any={react:state.react,"react/jsx-runtime":jsxRuntime,
    "@/components/shared/ModalShell":{ModalShell:Modal},
    "@/components/shared/AlertDialog":{AlertDialog:()=>null},
    "@/lib/auth-fetch":{authFetch:async()=>Response.json(response),assertApiResponse:async()=>{},ApiResponseError:class extends Error {}},
    "@/hooks/useBranchBonuses":{fetchBonus:(body:unknown)=>{sent.push(body);calculations++;return pending.promise;}},
    "./bonus-display":{primaryButton:"",secondaryButton:""},
  };
  for(const name of ["BonusRequired","BonusSettings","BonusSources","BonusChanges","BonusSummary","BonusExports","BonusDecimalField"]) dependencies[`./${name}`]={[name]:()=>null};
  const module=loadSourceModule<typeof import("../src/components/branch-bonus/BonusBatchForm")>("src/components/branch-bonus/BonusBatchForm.tsx",dependencies,{
    DOMException,window:{setTimeout,clearTimeout,addEventListener:()=>{},removeEventListener:()=>{},localStorage:{getItem:()=>null}},
  });
  return {render:()=>state.render(()=>module.BonusBatchForm({locationId,ownerId:locationId,saved:()=>{}})),
    pending:()=>pending, retry:()=>{pending=deferred();}, changed:()=>{response={...review,fingerprint:"c".repeat(32)};},
    calculations:()=>calculations,sent,close:()=>state.close()};
}
test("Next waits inside the existing modal, shares the calculation, then advances once",async()=>{
  const h=batchHarness();
  try{
    h.render();await tick();let tree=h.render();h.render();
    const next=button(tree,"ตรวจสอบและถัดไป").props.onClick;
    next();next();await tick();tree=h.render();
    expect(nodes(tree).some(n=>n.type===Modal)).toBe(true);
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(1);
    await new Promise(resolve=>setTimeout(resolve,270));expect(h.calculations()).toBe(1);
    h.pending().resolve(preview());await tick();tree=h.render();
    expect(nodes(tree).some(n=>n.type===Modal)).toBe(false);
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(2);
  }finally{h.close();}
});
test("a failed calculation closes the modal, stays on the same step, and can retry",async()=>{
  const h=batchHarness();
  try{
    h.render();await tick();let tree=h.render();h.render();
    button(tree,"ตรวจสอบและถัดไป").props.onClick();await new Promise(resolve=>setTimeout(resolve,270));h.pending().reject(new Error("คำนวณไม่สำเร็จ"));
    await tick();tree=h.render();
    expect(nodes(tree).some(n=>n.type===Modal)).toBe(false);
    expect(nodes(tree).find(n=>n.props.role==="alert").props.children).toBe("คำนวณไม่สำเร็จ");
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(1);
    h.retry();button(tree,"ตรวจสอบและถัดไป").props.onClick();await tick();h.pending().resolve(preview());await tick();tree=h.render();
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(2);
  }finally{h.close();}
});
test("changed REX inventory still returns to review instead of advancing",async()=>{
  const h=batchHarness();
  try{
    h.render();await tick();const tree=h.render();h.render();h.changed();
    button(tree,"ตรวจสอบและถัดไป").props.onClick();await tick();const next=h.render();
    expect(nodes(next).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(1);
    expect(nodes(next).find(n=>n.props.role==="alert").props.children).toContain("ชุดข้อมูลเปลี่ยนแล้ว");
  }finally{h.close();}
});

test("selection retains review panels and pages against their original input until the latest preview is ready",async()=>{
  const h=batchHarness();
  const sources=(tree:any)=>nodes(tree).find(n=>n.props.preview&&n.props.change&&n.props.load);
  try{
    h.render();await tick();let tree=h.render();h.render();
    button(tree,"ตรวจสอบและถัดไป").props.onClick();await new Promise(resolve=>setTimeout(resolve,270));h.pending().resolve(preview());await tick();tree=h.render();
    const panel=sources(tree);expect(panel).toBeTruthy();h.retry();
    panel.props.change({...panel.props.input,excludedGroups:["expense"]});tree=h.render();
    const retained=sources(tree);expect(retained).toBeTruthy();expect(retained.type).toBe(panel.type);
    expect(retained.props.input.excludedGroups).toEqual(["expense"]);
    void retained.props.load("expenses",50);expect(h.sent.at(-1).input.excludedGroups).toEqual([]);
    expect(nodes(tree).some(n=>n.props.role==="status"&&String(n.props.children).includes("ผลก่อนหน้า"))).toBe(true);
    button(tree,"ถัดไป").props.onClick();await tick();tree=h.render();
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(2);
    await new Promise(resolve=>setTimeout(resolve,270));h.pending().resolve(preview());await tick();tree=h.render();
    expect(nodes(tree).find(n=>n.props["aria-current"]==="step").props.children[0]).toBe(3);
    expect(h.sent.filter(body=>body.action==="previewBatch").at(-1).periods[0].input.excludedGroups).toEqual(["expense"]);
  }finally{h.close();}
});

test("reference selection invalidates the calculation key and reaches the batch request",async()=>{
  const h=batchHarness();
  try{
    h.render();await tick();let tree=h.render();button(tree,"ตรวจสอบและถัดไป").props.onClick();
    await new Promise(resolve=>setTimeout(resolve,270));h.pending().resolve(preview());await tick();tree=h.render();h.retry();
    const picker=nodes(tree).find(n=>n.props.branches);expect(picker).toBeTruthy();
    const other="b0060000-0000-4000-8000-000000000002";picker.props.change([other]);tree=h.render();
    expect(nodes(tree).find(n=>n.props.branches).props.excluded).toEqual([other]);
    expect(nodes(tree).some(n=>n.props.role==="status"&&String(n.props.children).includes("ผลก่อนหน้า"))).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,270));expect(h.sent.at(-1).referenceExcludedLocationIds).toEqual([other]);
    h.pending().resolve(preview());await tick();
  }finally{h.close();}
});

test("change pages validate their own fingerprint when the reference fingerprint differs",async()=>{
  const state=runtime();const row:BonusChange={bonus_id:locationId,source_key:"expense:1",label:"Changed",old_amount:1,new_amount:2,unknown:false,old_included:true,period_start:"2020-01-01",period_end:"2020-01-01",old_date:"2020-01-01",new_date:"2020-01-01"};
  const module=loadSourceModule<typeof import("../src/components/branch-bonus/BonusChanges")>("src/components/branch-bonus/BonusChanges.tsx",{react:state.react,"react/jsx-runtime":jsxRuntime});
  const render=()=>state.render(()=>module.BonusChanges({rows:Array.from({length:50},(_,i)=>({...row,source_key:`expense:${i}`})),total:51,fingerprint:"reference",pageFingerprint:"financial",load:async()=>({rows:[{...row,source_key:"expense:last"}],sourceFingerprint:"another-reference",pageFingerprint:"financial"})}));
  try{
    button(render(),"ดูส่วนต่างเพิ่ม").props.onClick();await tick();const tree=render();
    expect(button(tree,"ดูส่วนต่างเพิ่ม")).toBeUndefined();expect(nodes(tree).some(n=>n.props.role==="alert")).toBe(false);
  }finally{state.close();}
});

const source=(amount:number):BonusSource=>({key:`expense:${amount}`,id:String(amount),kind:"expense",date:"2020-01-01",occurredAt:"2020-01-01",label:`Expense ${amount}`,amount,included:true});
function sourceHarness(load:(section:string,offset:number,signal?:AbortSignal)=>Promise<any>) {
  const state=runtime();
  const module=loadSourceModule<typeof import("../src/components/branch-bonus/BonusSources")>("src/components/branch-bonus/BonusSources.tsx",{
    react:state.react,"react/jsx-runtime":jsxRuntime,"./bonus-display":{bonusNumber:String,costLabels:{expense:"ค่าใช้จ่าย"},secondaryButton:""},
  });
  const data={sourceFingerprint:"a",complete:true,expenses:[source(1)],purchases:[],counts:[],sourceCounts:{expenses:3,purchases:0,counts:0},expenseGroups:[]} as unknown as BonusPreview;
  return {data,render:()=>state.render(()=>module.BonusSources({preview:data,input:newBonusSettings(),load})),close:()=>state.close()};
}
test("expense sorting includes the largest source from the last page before showing any rows",async()=>{
  const offsets:number[]=[],last=deferred<any>();
  const h=sourceHarness(async(_,offset)=>{offsets.push(offset);return offset===1?{sourceFingerprint:"a",rows:[source(2)]}:last.promise;});
  try{
    let tree=h.render();nodes(tree).find(n=>n.type==="details").props.onToggle({currentTarget:{open:true}});h.render();await tick();tree=h.render();
    expect(offsets).toEqual([1,2]);expect(nodes(tree).filter(n=>n.type==="label"&&n.props.className.includes("items-start"))).toHaveLength(0);
    last.resolve({sourceFingerprint:"a",rows:[source(999)]});await tick();tree=h.render();
    const labels=nodes(tree).filter(n=>n.type==="label"&&n.props.className.includes("items-start"));
    expect(labels.map(n=>n.props.children.at(-1).props.children)).toEqual(["999","2","1"]);
    expect(button(tree,"Sort Descending")).toBeUndefined();
  }finally{h.close();}
});

test("leaving the source panel cancels its request and stops fetching later pages",async()=>{
  const pending=deferred<any>(),signals:Array<AbortSignal|undefined>=[],offsets:number[]=[];
  const h=sourceHarness(async(_,offset,signal)=>{offsets.push(offset);signals.push(signal);return pending.promise;});
  const tree=h.render();nodes(tree).find(n=>n.type==="details").props.onToggle({currentTarget:{open:true}});h.render();await tick();
  h.close();pending.resolve({sourceFingerprint:"a",rows:[source(2)]});await tick();
  expect(offsets).toEqual([1]);expect(signals[0]?.aborted).toBe(true);
});

test("a changed preview restarts an open expense disclosure after cancelling the older page",async()=>{
  const old=deferred<any>(),offsets:number[]=[];
  const h=sourceHarness(async(_,offset)=>{offsets.push(offset);return offsets.length===1?old.promise:{sourceFingerprint:"b",rows:[source(8),source(9)]};});
  try{
    let tree=h.render();nodes(tree).find(n=>n.type==="details").props.onToggle({currentTarget:{open:true}});h.render();await tick();
    h.data.sourceFingerprint="b";h.render();old.resolve({sourceFingerprint:"a",rows:[source(999)]});await tick();tree=h.render();await tick();tree=h.render();
    expect(offsets).toEqual([1,1]);
    expect(nodes(tree).filter(n=>n.type==="label"&&n.props.className.includes("items-start")).map(n=>n.props.children.at(-1).props.children)).toEqual(["9","8","1"]);
  }finally{h.close();}
});

test("retrying a failed expense page keeps validated progress instead of fetching every page again",async()=>{
  const offsets:number[]=[];let fail=true;
  const h=sourceHarness(async(_,offset)=>{offsets.push(offset);if(offset===2&&fail)throw new Error("network failure");return {sourceFingerprint:"a",rows:[source(offset+1)]};});
  try{
    let tree=h.render();nodes(tree).find(n=>n.type==="details").props.onToggle({currentTarget:{open:true}});h.render();await tick();tree=h.render();
    expect(nodes(tree).some(n=>n.props.role==="alert")).toBe(true);
    fail=false;button(tree,"โหลดรายละเอียดเพิ่ม").props.onClick();await tick();tree=h.render();
    expect(offsets).toEqual([1,2,2]);
    expect(nodes(tree).filter(n=>n.type==="label"&&n.props.className.includes("items-start"))).toHaveLength(3);
  }finally{h.close();}
});
test("changed fingerprints and empty pages never display a partial expense sort as complete",async()=>{
  for(const result of [{sourceFingerprint:"changed",rows:[source(999)]},{sourceFingerprint:"a",rows:[]}]){
    const h=sourceHarness(async()=>result);
    try{
      let tree=h.render();nodes(tree).find(n=>n.type==="details").props.onToggle({currentTarget:{open:true}});h.render();await tick();tree=h.render();
      expect(nodes(tree).some(n=>n.props.role==="alert")).toBe(true);
      expect(nodes(tree).filter(n=>n.type==="label"&&n.props.className.includes("items-start"))).toHaveLength(0);
      expect(button(tree,"โหลดรายละเอียดเพิ่ม").props.disabled).toBe(false);
    }finally{h.close();}
  }
});

function changesHarness(load:(offset:number,signal?:AbortSignal)=>Promise<any>) {
  const state=runtime();
  const module=loadSourceModule<typeof import("../src/components/branch-bonus/BonusChanges")>("src/components/branch-bonus/BonusChanges.tsx",{
    react:state.react,"react/jsx-runtime":jsxRuntime,"./bonus-display":{bonusNumber:String,secondaryButton:""},
  });
  const props={rows:[] as BonusChange[],total:1,fingerprint:"a",load};
  return {props,render:()=>state.render(()=>module.BonusChanges(props)),close:()=>state.close()};
}
test("a new difference fingerprint can load while the previous request is still pending",async()=>{
  const old=deferred<any>(),latest=deferred<any>(),signals:Array<AbortSignal|undefined>=[];
  const h=changesHarness(async(_,signal)=>{signals.push(signal);return signals.length===1?old.promise:latest.promise;});
  try{
    button(h.render(),"ดูส่วนต่างเพิ่ม").props.onClick();h.render();
    h.props.fingerprint="b";h.render();let tree=h.render();
    expect(button(tree,"ดูส่วนต่างเพิ่ม").props.disabled).toBe(false);
    expect(signals[0]?.aborted).toBe(true);
    button(tree,"ดูส่วนต่างเพิ่ม").props.onClick();h.render();
    latest.resolve({sourceFingerprint:"b",rows:[{bonus_id:"new",source_key:"expense:new",label:"Latest difference"}]});
    await tick();tree=h.render();expect(nodes(tree).some(n=>n.props.children==="Latest difference")).toBe(true);
    old.reject(new Error("outdated request failure"));await tick();tree=h.render();
    expect(nodes(tree).some(n=>n.props.role==="alert")).toBe(false);
  }finally{h.close();old.resolve({sourceFingerprint:"a",rows:[]});latest.resolve({sourceFingerprint:"b",rows:[]});}
});
test("leaving differences aborts the request",async()=>{
  const pending=deferred<any>();let signal:AbortSignal|undefined;
  const h=changesHarness(async(_,value)=>{signal=value;return pending.promise;});
  button(h.render(),"ดูส่วนต่างเพิ่ม").props.onClick();h.close();
  pending.resolve({sourceFingerprint:"a",rows:[]});await tick();expect(signal?.aborted).toBe(true);
});
test("an empty difference page offers an explicit retry",async()=>{
  const retry=changesHarness(async()=>({sourceFingerprint:"a",rows:[]}));
  try{
    button(retry.render(),"ดูส่วนต่างเพิ่ม").props.onClick();await tick();const tree=retry.render();
    expect(nodes(tree).some(n=>n.props.role==="alert")).toBe(true);
    expect(button(tree,"ดูส่วนต่างเพิ่ม").props.disabled).toBe(false);
  }finally{retry.close();}
});

function recoveryHarness(kind:"batch"|"legacy",status:number) {
  const state=runtime(),storage=new Map<string,string>(),sent:any[]=[];
  const input={...newBonusSettings(),exportIds:[locationId],rate:.02,
    metrics:{burden:{weight:0,target:null},loss:{weight:100,target:10},counts:{weight:0,target:null},age:{weight:0,target:null}}};
  const id="b0070000-0000-4000-8000-000000000001";
  const intent=kind==="batch"
    ? {version:1,id,ownerId:locationId,locationId,referenceExcludedLocationIds:["b0060000-0000-4000-8000-000000000002"],review:"b".repeat(32),periods:[{key:"0",input,expected:"a".repeat(32),finalAmount:null}]}
    : {id,ownerId:locationId,locationId,input,expected:"a".repeat(32),finalAmount:null};
  const storageKey=kind==="batch"?`lanflow:bonus-batch:${locationId}:${locationId}`:`lanflow:bonus-intent:${locationId}:${locationId}`;
  storage.set(storageKey,JSON.stringify(intent));
  const window={setTimeout,clearTimeout,addEventListener:()=>{},removeEventListener:()=>{},
    localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}};
  let failure=status;
  const auth=loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts",{
    "@/lib/network-abort":{abortableFetch:async(_url:string,init:any)=>{
      if(!init?.body)return Response.json({rows:[],hasMore:false});
      sent.push(JSON.parse(init.body));
      return failure?Response.json({error:"temporary recovery failure"},{status:failure}):Response.json({id,results:[],deletedIds:[]});
    }},
  },{window});
  const dependencies:any={react:state.react,"react/jsx-runtime":jsxRuntime,"@/lib/auth-fetch":auth,
    "@/components/shared/ModalShell":{ModalShell:Modal},"@/components/shared/AlertDialog":{AlertDialog:()=>null},
    "./bonus-display":{primaryButton:"",secondaryButton:""}};
  for(const name of ["BonusRequired","BonusSettings","BonusSources","BonusChanges","BonusSummary","BonusExports","BonusDecimalField"]) dependencies[`./${name}`]={[name]:()=>null};
  const module=kind==="batch"
    ? loadSourceModule<typeof import("../src/components/branch-bonus/BonusBatchForm")>("src/components/branch-bonus/BonusBatchForm.tsx",dependencies,{window,DOMException})
    : loadSourceModule<typeof import("../src/hooks/useBranchBonuses")>("src/hooks/useBranchBonuses.ts",dependencies,{window});
  const render=()=>state.render(()=>kind==="batch"
    ? (module as typeof import("../src/components/branch-bonus/BonusBatchForm")).BonusBatchForm({locationId,ownerId:locationId,saved:()=>{}})
    : (module as typeof import("../src/hooks/useBranchBonuses")).useBranchBonuses(locationId,locationId,true));
  return {render,retry:async()=>{const result=render();if(kind==="batch")button(result,"ตรวจผลคำขอเดิมทั้งชุด").props.onClick();else await result.retryLegacy();await tick();},
    pending:()=>storage.get(storageKey),id,sent,succeed:()=>{failure=0;},close:()=>state.close()};
}
for(const kind of ["batch","legacy"] as const){
  for(const status of [401,403,408,429,503])test(`${kind} recovery retains the exact pending identity after HTTP ${status}`,async()=>{
    const h=recoveryHarness(kind,status);
    try{
      const before=h.pending();await h.retry();
      expect(h.pending()).toBe(before);
      h.succeed();await h.retry();expect(h.pending()).toBeUndefined();
      expect(h.sent.map(body=>body.id)).toEqual([h.id,h.id]);
      if(kind==="batch")expect(h.sent.map(body=>body.referenceExcludedLocationIds)).toEqual([["b0060000-0000-4000-8000-000000000002"],["b0060000-0000-4000-8000-000000000002"]]);
    }finally{h.close();}
  });
  for(const status of [400,409])test(`${kind} recovery still clears a definitive HTTP ${status} rejection`,async()=>{
    const h=recoveryHarness(kind,status);
    try{await h.retry();expect(h.pending()).toBeUndefined();}finally{h.close();}
  });
}

function decimalHarness() {
  const state=runtime();let value=10;
  const module=loadSourceModule<typeof import("../src/components/branch-bonus/BonusDecimalField")>("src/components/branch-bonus/BonusDecimalField.tsx",{
    react:state.react,"react/jsx-runtime":jsxRuntime,
  });
  const render=()=>state.render(()=>module.BonusDecimalField({label:"Final bonus",value,change:next=>{value=next;}}));
  const input=()=>nodes(render()).find(n=>n.type==="input");
  return {render,value:()=>value,edit:(text:string)=>{
    input().props.onFocus();input().props.onChange({target:{value:text}});input().props.onBlur();return render();
  },refocus:()=>{input().props.onFocus();input().props.onBlur();return render();},close:()=>state.close()};
}
for(const text of [",",",,","1,,2","1,23","123,","1,234,56","1,234.5,6"])
  test(`malformed decimal commas cannot silently become a valid bonus amount: ${text}`,()=>{
    const h=decimalHarness();
    try{
      const tree=h.edit(text);
      expect(Number.isNaN(h.value()),text).toBe(true);
      const field=nodes(tree).find(n=>n.type==="input");
      expect(field.props["aria-invalid"]).toBe(true);expect(field.props.value).toBe(text);
      expect(nodes(tree).some(n=>n.props.id===field.props["aria-describedby"]&&n.props.role==="alert")).toBe(true);
    }finally{h.close();}
  });
test("decimal input retains valid grouping, rounding and deliberate blank-zero behavior",()=>{
  for(const [text,expected] of [["",0],["  ",0],["0",0],[".5",.5],["1234.56",1234.56],["1,234.56",1234.56],["+1,000.50",1000.5],["1,234,567.89",1234567.89],["1.236",1.24]] as const){
    const h=decimalHarness();
    try{const tree=h.edit(text);expect(h.value(),text).toBe(expected);expect(nodes(tree).find(n=>n.type==="input").props["aria-invalid"]).toBe(false);}finally{h.close();}
  }
});
test("invalid decimal text stays invalid when refocused without a correction",()=>{
  const h=decimalHarness();
  try{
    h.edit("invalid");expect(Number.isNaN(h.value())).toBe(true);
    const tree=h.refocus();expect(Number.isNaN(h.value())).toBe(true);
    expect(nodes(tree).find(n=>n.type==="input").props.value).toBe("invalid");
  }finally{h.close();}
});

function listMutationHarness(deleteStatus=200) {
  const state=runtime(),pending=deferred<Response>(),signals:Array<AbortSignal|undefined>=[];
  const removed="b0070000-0000-4000-8000-000000000001",remaining="b0070000-0000-4000-8000-000000000002";
  const row=(id:string)=>({id,periodStart:"2020-01-01",periodEnd:"2020-01-01",createdAt:"2020-01-02T00:00:00Z",createdByName:"Test",finalAmount:10,suggestedAmount:10,weight:100});
  const stale={rows:[row(removed),row(remaining)],hasMore:false},fresh={rows:[row(remaining)],hasMore:false};
  const auth=loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts",{
    "@/lib/network-abort":{abortableFetch:async(_url:string,init:any)=>{
      if(init?.method==="POST")return Response.json(deleteStatus===200?{deleted:true}:{error:"delete failed"},{status:deleteStatus});
      signals.push(init.signal);
      return signals.length===1?Response.json(stale):signals.length===2?pending.promise:Response.json(fresh);
    }},
  });
  const module=loadSourceModule<typeof import("../src/hooks/useBranchBonuses")>("src/hooks/useBranchBonuses.ts",{react:state.react,"@/lib/auth-fetch":auth});
  return {removed,remaining,signals,render:():ReturnType<typeof module.useBranchBonuses>=>state.render(()=>module.useBranchBonuses(locationId,locationId,true)),
    release:()=>pending.resolve(Response.json(stale)),close:()=>state.close()};
}
test("confirmed bonus deletion removes its row before any follow-up read",async()=>{
  const h=listMutationHarness();
  try{
    h.render();await tick();const api=h.render();expect(api.list.rows).toHaveLength(2);
    expect(await api.remove(h.removed)).toBe(true);
    expect(h.render().list.rows.map(row=>row.id)).toEqual([h.remaining]);
  }finally{h.close();}
});
test("deletion cancels an older bonus list read and allows an immediate refresh",async()=>{
  const h=listMutationHarness();
  try{
    h.render();await tick();let api=h.render();const old=api.load("list");await tick();api=h.render();
    expect(await api.remove(h.removed)).toBe(true);
    await h.render().load("list");
    expect(h.signals).toHaveLength(3);expect(h.signals[1]?.aborted).toBe(true);
    h.release();await old;api=h.render();
    expect(api.list.rows.map(row=>row.id)).toEqual([h.remaining]);expect(api.loading).toBeNull();
  }finally{h.release();h.close();}
});
test("a failed bonus deletion preserves its row and the pending list read",async()=>{
  const h=listMutationHarness(503);
  try{
    h.render();await tick();let api=h.render();const old=api.load("list");await tick();
    expect(await h.render().remove(h.removed)).toBe(false);
    expect(h.signals[1]?.aborted).toBe(false);h.release();await old;api=h.render();
    expect(api.list.rows.map(row=>row.id)).toEqual([h.removed,h.remaining]);expect(api.error).toBe("delete failed");
  }finally{h.release();h.close();}
});
