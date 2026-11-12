import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { newBonusSettings, parseBonusSettings } from "../src/lib/branch-bonus/input";
import { parseBonusBatch, parseBonusReference } from "../src/lib/branch-bonus/batch";
import { canViewNavigationTab } from "../src/components/lanflow/NavigationTabs";
import { isTabBlockedOffline } from "../src/lib/offline-module-policy";
import type { Profile } from "../src/types";

const location = "b0020000-0000-4000-8000-000000000001", id = "b0070000-0000-4000-8000-000000000001";
const settings = () => ({ ...newBonusSettings(), exportIds: ["b0030000-0000-4000-8000-000000000001"], rate: .02,
  metrics: { burden: { weight: 0, target: 0 }, loss: { weight: 100, target: 10 }, counts: { weight: 0, target: null }, age: { weight: 0, target: null } } });
function harness(options: { status?: number; error?: string; transport?: boolean; authThrows?: boolean } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/branch-bonuses/route")>("src/app/api/lanflow/branch-bonuses/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => {
      if (options.authThrows) throw new Error("private auth detail");
      return options.status ? { ok: false, response: Response.json({ error: "denied" }, { status: options.status }) }
        : { ok: true, supabase: { rpc: async (name: string, args: unknown) => {
          calls.push({ name, args }); if (options.transport) throw new Error("private database detail");
          return { data: { rows: [], canConfirm: true }, error: options.error ? { code: "P0001", message: options.error } : null };
        } } };
    } },
  });
  const get = (query = `locationId=${location}`) => route.GET(new Request(`http://localhost/api/lanflow/branch-bonuses?${query}`));
  const post = (body: unknown) => route.POST(new Request("http://localhost/api/lanflow/branch-bonuses", { method: "POST", body: JSON.stringify(body) }));
  return { calls, get, post };
}

test("all bonus reads and writes use the manager boundary before input/RPC", async () => {
  for (const status of [401, 403]) {
    const h = harness({ status });
    expect((await h.get("invalid")).status).toBe(status);
    for (const action of ["preview", "sources", "confirm", "delete"]) expect((await h.post({ action })).status).toBe(status);
    expect(h.calls).toHaveLength(0);
  }
});
test("candidate and history cursors preserve scope and validate both tuple values", async () => {
  const h = harness();
  expect((await h.get(`locationId=${location}&view=candidates&before=2020-01-12T00:00:00Z&beforeId=${id}`)).status).toBe(200);
  expect(h.calls[0]).toEqual({ name: "get_branch_bonus_candidates", args: { p_location: location, p_before: "2020-01-12T00:00:00Z", p_before_id: id } });
  for (const suffix of ["view=bad", "beforeId=" + id, "before=bad", "offset=-1", "id=bad"]) expect((await h.get(`locationId=${location}&${suffix}`)).status).toBe(400);
  expect(h.calls).toHaveLength(1);
});
test("preview normalizes settings and never accepts client totals or periods", async () => {
  const h = harness();
  const response = await h.post({ action: "preview", locationId: location, input: settings(), periodStart: "1900-01-01", suggestedAmount: 999 });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(h.calls).toEqual([{ name: "preview_branch_bonus", args: { p_location: location, p_input: parseBonusSettings(settings()) } }]);
});
test("confirm forwards a canonical request identity, fingerprint and manual amount", async () => {
  const h = harness();
  expect((await h.post({ action: "confirm", locationId: location, input: settings(), id, expected: "a".repeat(32), finalAmount: 0 })).status).toBe(200);
  expect(h.calls[0]).toEqual({ name: "confirm_branch_bonus", args: { p_location: location, p_id: id, p_input: parseBonusSettings(settings()), p_expected: "a".repeat(32), p_final_amount: 0 } });
  for (const change of [{ id: "bad" }, { expected: "bad" }, { finalAmount: -1 }, { finalAmount: .001 }, { finalAmount: "2" }]) {
    expect((await h.post({ action: "confirm", locationId: location, input: settings(), id, expected: "a".repeat(32), finalAmount: null, ...change })).status).toBe(400);
  }
  expect(h.calls).toHaveLength(1);
});
test("source details page saved snapshots independently of live input", async () => {
  const h = harness();
  expect((await h.post({ action: "sources", locationId: location, id, section: "expenses", offset: 1000 })).status).toBe(200);
  expect(h.calls[0]).toEqual({ name: "get_branch_bonus_source_page", args: { p_location: location, p_bonus_id: id, p_input: null, p_section: "expenses", p_offset: 1000 } });
  expect((await h.post({ action: "sources", locationId: location, id, section: "bad", offset: 0 })).status).toBe(400);
  expect((await h.post({ action: "sources", locationId: location, id, section: "expenses", offset: .5 })).status).toBe(400);
});
for (const [message, status] of [["BONUS_FORBIDDEN: ไม่มีสิทธิ์",403], ["BONUS_NOT_FOUND: ไม่พบ",404],
  ["BONUS_INVALID: เป้าไม่ถูกต้อง",400], ["BONUS_SOURCE_CHANGED: โหลดข้อมูลใหม่",409],
  ["BONUS_CONFLICT: ช่วงซ้อน",409], ["BONUS_HISTORY_LOCKED: ลบโบนัสก่อน",409], ["private SQL error",503]] as const) {
  test(`bonus business/opaque response ${status}: ${message}`, async () => {
    const response = await harness({ error: message }).post({ action: "delete", locationId: location, id });
    expect(response.status).toBe(status);
    if (status === 503) expect(JSON.stringify(await response.json())).not.toContain("SQL");
  });
}
test("GET and POST bound unexpected transport/auth failures", async () => {
  for (const options of [{ transport: true }, { authThrows: true }]) {
    const h = harness(options);
    for (const response of [await h.get(), await h.post({ action: "delete", locationId: location, id })]) {
      expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private");
    }
  }
});
test("settings reject invalid identity, unknown fields, precision and target shape", () => {
  expect(parseBonusSettings(settings())?.metrics.burden.target).toBeNull();
  for (const value of [null, [], {}, { ...settings(), exportIds: [] }, { ...settings(), exportIds: [id,id] },
    { ...settings(), rate: NaN }, { ...settings(), rate: .00001 }, { ...settings(), unexpected: true },
    { ...settings(), excludedGroups: ["made-up"] }, { ...settings(), metrics: {} },
    { ...settings(), metrics: { ...settings().metrics, burden: { weight: 1, target: "1" } } }]) expect(parseBonusSettings(value)).toBeNull();
});
test("zero-weight sides ignore invalid or omitted old targets instead of blocking preview", () => {
  for (const target of [-1, "unfinished", undefined]) {
    const value={ ...settings(),metrics:{ ...settings().metrics,burden:{weight:0,target} } };
    expect(parseBonusSettings(value)?.metrics.burden.target).toBeNull();
  }
});

test("source exclusions normalize UUID case and reject malformed or duplicate identities", () => {
  const lower="expense:b0050000-0000-4000-8000-000000000001";
  const upper="expense:B0050000-0000-4000-8000-000000000001";
  expect(parseBonusSettings({...settings(),excludedKeys:[upper]})?.excludedKeys).toEqual([lower]);
  for(const excludedKeys of [["expense:"+"-".repeat(36)],[lower,upper],[lower+":extra"]]) expect(parseBonusSettings({...settings(),excludedKeys})).toBeNull();
  expect(parseBonusSettings({...settings(),exportIds:[id,id.toUpperCase()]})).toBeNull();
});

test("automatic count goals ignore unfinished old targets while preserving valid replay input", () => {
  for(const target of [-1,"unfinished",undefined]) expect(parseBonusSettings({...settings(),metrics:{...settings().metrics,counts:{weight:100,target}}})?.metrics.counts.target).toBeNull();
  expect(parseBonusSettings({...settings(),metrics:{...settings().metrics,counts:{weight:100,target:10}}})?.metrics.counts.target).toBe(10);
});

test("source pagination rejects offsets outside PostgreSQL integer range before calling RPC", async () => {
  const h=harness();
  for(const offset of [2147483648,Number.MAX_SAFE_INTEGER]){
    expect((await h.get(`locationId=${location}&view=changes&offset=${offset}`)).status).toBe(400);
    expect((await h.post({action:"sources",locationId:location,id,section:"expenses",offset})).status).toBe(400);
  }
  expect(h.calls).toHaveLength(0);
});
test("bonus navigation uses manager capability and is online-only", () => {
  const profile: Profile = { id, phone: "0890000000", name: "Test", role: "admin", isActive: true, locationIds: [location] };
  expect(canViewNavigationTab("branch-bonus", profile)).toBe(false);
  expect(canViewNavigationTab("branch-bonus", { ...profile, role: "super_admin" })).toBe(true);
  expect(canViewNavigationTab("branch-bonus", { ...profile, canAccessSystemManager: true })).toBe(true);
  expect(canViewNavigationTab("branch-bonus", { ...profile, role: "user", canAccessSystemManager: true })).toBe(false);
  expect(isTabBlockedOffline("branch-bonus", false)).toBe(true);
});

test("batch review and confirmation use the manager route and canonical periods",async()=>{
  const h=harness();
  expect((await h.get(`locationId=${location}&view=review`)).status).toBe(200);
  expect(h.calls[0]).toEqual({name:"review_branch_bonus",args:{p_location:location}});
  const periods=[{key:"0",input:settings(),expected:"a".repeat(32),finalAmount:0}];
  expect((await h.post({action:"confirmBatch",id,locationId:location,review:"b".repeat(32),periods})).status).toBe(200);
  expect(h.calls[1]).toEqual({name:"confirm_branch_bonus_batch",args:{p_location:location,p_id:id,p_review:"b".repeat(32),p_periods:parseBonusBatch(periods,true)}});
  expect((await harness({status:403}).post({action:"confirmBatch"})).status).toBe(403);
});
test("new batch precision rejects fractional weights while legacy pending input remains valid",()=>{
  const legacy={...settings(),rate:.0125,metrics:{...settings().metrics,loss:{weight:12.5,target:10}}};
  expect(parseBonusSettings(legacy)).not.toBeNull();
  expect(parseBonusBatch([{key:"0",input:legacy}])).toBeNull();
  expect(parseBonusBatch([{key:"0",input:settings()},{key:"0",input:settings()}])).toBeNull();
  expect(parseBonusBatch([{key:"0",input:settings(),finalAmount:-1}])).toBeNull();
  expect(parseBonusBatch([{key:"0",input:settings()}],true)).toBeNull();
});

test("batch limits cover the whole request, not just each period",()=>{
  const ids=Array.from({length:5000},(_,n)=>`d0030000-0000-4000-8000-${String(n).padStart(12,'0')}`);
  const large={...settings(),exportIds:ids};
  expect(parseBonusBatch([{key:"0",input:large}])).not.toBeNull();
  expect(parseBonusBatch([{key:"0",input:large},{key:"1",input:settings()}])).toBeNull();
  expect(parseBonusBatch(Array.from({length:101},(_,n)=>({key:String(n),input:settings()})))).toBeNull();
  expect(parseBonusBatch([{key:"0",input:{...settings(),rate:.025}}])).toBeNull();
});

test("age requests use the fourth metric with day precision and canonical disabled targets",async()=>{
  const input={...settings(),metrics:{...settings().metrics,loss:{weight:0,target:null},age:{weight:100,target:5.25}}};
  expect(parseBonusBatch([{key:"0",input}])?.[0].input.metrics.age).toEqual({weight:100,target:5.25});
  for(const age of [{weight:.5,target:5},{weight:100,target:5.001},{weight:100,target:Infinity}]){
    expect(parseBonusBatch([{key:"0",input:{...input,metrics:{...input.metrics,age}}}])).toBeNull();
  }
  expect(parseBonusSettings({...input,metrics:{...input.metrics,age:{weight:0,target:"unfinished"}}})?.metrics.age.target).toBeNull();
  const h=harness();await h.post({action:"previewBatch",locationId:location,review:"a".repeat(32),periods:[{key:"0",input}]});
  expect(h.calls[0].name).toBe("preview_branch_bonus_batch");
  expect(h.calls[0].args).toMatchObject({p_periods:[{input:{metrics:{age:{weight:100,target:5.25}}}}]});
});

test("schema bootstrap applies age and reference even when batch already exists or is rebuilt",()=>{
  for(const initialBatch of [true,false]){
    let batch=initialBatch,age=false,reference=false;const applied:string[]=[];
    const files=["20261104016000_branch_bonus_batches.sql","20261112010000_branch_bonus_verified_age.sql","20261112020000_branch_bonus_reference_targets.sql","20261109010000_reject_null_income_expense_approval_decision.sql"];
    const module=loadSourceModule<typeof import("./support/branch-bonus-test-schema")>("tests/support/branch-bonus-test-schema.ts",{
      "node:fs":{readdirSync:()=>files,readFileSync:(path:string)=>path},
      "node:child_process":{
        execFileSync:(_name:string,args:string[])=>args.at(-1)!.includes("branch_bonus_reference")?reference?"t":"f":args.at(-1)!.includes("to_regprocedure")?batch?"batch":"":args.at(-1)!.includes("to_regclass")?"base":age?"t":"f",
        spawnSync:(_name:string,_args:string[],options:{input:string})=>{applied.push(options.input);if(options.input.includes("batches.sql"))batch=true;else if(options.input.includes("reference_targets"))reference=true;else age=true;return {status:0};},
      },
    });
    module.ensureBonusBatchSchema("disposable","age_test");
    expect(applied).toContain("supabase/migrations/20261112010000_branch_bonus_verified_age.sql");
    expect(applied).not.toContain("supabase/migrations/20261109010000_reject_null_income_expense_approval_decision.sql");
    module.ensureBonusBatchSchema("disposable","age_test");
    expect(applied).toHaveLength(initialBatch?2:3);
  }
});


test("reference selection has one canonical batch scope and rejects malformed or own-branch exclusions",async()=>{
  const other="b0020000-0000-4000-8000-0000000000AB";
  expect(parseBonusReference([other],location)).toEqual([other.toLowerCase()]);
  for(const value of [null,{},[location],[other,other.toLowerCase()],["bad"]])expect(parseBonusReference(value,location)).toBeNull();
  const h=harness(),periods=[{key:"0",input:settings()}];
  expect((await h.post({action:"previewBatch",locationId:location,review:"a".repeat(32),periods,referenceExcludedLocationIds:[other]})).status).toBe(200);
  expect(h.calls[0]).toEqual({name:"preview_branch_bonus_batch",args:{p_location:location,p_review:"a".repeat(32),p_periods:{periods:parseBonusBatch(periods),excludedLocationIds:[other.toLowerCase()]}}});
  expect((await h.post({action:"previewBatch",locationId:location,review:"a".repeat(32),periods,referenceExcludedLocationIds:[location]})).status).toBe(400);
  expect(h.calls).toHaveLength(1);
});
