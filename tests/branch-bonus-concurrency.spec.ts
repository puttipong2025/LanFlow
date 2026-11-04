import { expect, test } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ensureBonusBatchSchema } from "./support/branch-bonus-test-schema";
import { newBonusSettings } from "../src/lib/branch-bonus/input";

const container = "supabase_db_webapp", branch = "b0020000-0000-4000-8000-000000000001";
const actor = "b0010000-0000-4000-8000-000000000001", rex = "b0030000-0000-4000-8000-000000000001";
const auth = `select set_config('request.jwt.claim.sub','${actor}',true);`;
const args = (db: string) => ["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1"];
const sql = (db: string, query: string) => execFileSync("docker", [...args(db), "-c", query], { encoding: "utf8", windowsHide: true }).trim();
let db: string;
const input = () => JSON.stringify({ ...newBonusSettings(), exportIds: [rex], rate: .02,
  metrics: { burden: { weight: 50, target: 5 }, loss: { weight: 40, target: 10 }, counts: { weight: 10, target: 10 } } });
function preview(){
  const review=JSON.parse(sql(db,`begin;${auth} select public.review_branch_bonus('${branch}');rollback;`).split('\n').at(-1)!);
  const periods=[{key:review.periods[0].key,input:JSON.parse(input())}];
  const result=JSON.parse(sql(db,`begin;${auth} select public.preview_branch_bonus_batch('${branch}','${review.fingerprint}','${JSON.stringify(periods)}');rollback;`).split('\n').at(-1)!);
  return {review:review.fingerprint,periods:periods.map(p=>({...p,expected:result.periods[0].preview.sourceFingerprint}))};
}
const confirm=(id:string,payload:ReturnType<typeof preview>)=>`select public.confirm_branch_bonus_batch('${branch}','${id}','${payload.review}','${JSON.stringify(payload.periods)}');`;

function session() {
  const child = spawn("docker", args(db), { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
  });
  child.stdin.write(`begin;set statement_timeout='8s';set deadlock_timeout='100ms';${auth}\n`);
  return { done, send: (query: string) => child.stdin.write(query + "\n"), finish: (query: string) => child.stdin.end(query + "\n"),
    wait: async (marker: string) => { await expect.poll(() => stdout.includes(marker) || stderr, { timeout: 5000 }).toBe(true); } };
}
async function blocked(id: string) {
  await expect.poll(() => Number(sql(db, `select count(*) from pg_stat_activity where datname='${db}' and wait_event_type='Lock' and query like '%${id}%'`)), { timeout: 4000 }).toBeGreaterThan(0);
}

test.describe.serial('branch bonus batch database contention and upgrade',()=>{
  test.beforeAll(()=>{
    test.setTimeout(90000);db=`branch_bonus_test_${crypto.randomUUID().replaceAll('-','')}`;
    execFileSync('docker',['exec',container,'createdb','-U','postgres',db],{windowsHide:true});
    const schema=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-privileges','--exclude-extension=pg_cron','--exclude-extension=pg_net'],{maxBuffer:25*1024*1024,windowsHide:true});
    const restored=spawnSync('docker',args(db),{input:schema,maxBuffer:25*1024*1024,windowsHide:true});expect(restored.status,restored.stderr.toString()).toBe(0);
    // The ordinary Local schema may already include batches. Downgrade only
    // this disposable clone before proving an upgrade from the real old writer.
    sql(db,`drop function if exists public.review_branch_bonus(uuid),public.preview_branch_bonus_batch(uuid,text,jsonb),
      public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb),public.get_branch_bonus_batch(uuid,uuid),
      private.branch_bonus_batch_calculate(uuid,text,jsonb,timestamptz),private.branch_bonus_review(uuid);
      drop table if exists private.branch_bonus_batches;`);
    const commands=readFileSync('supabase/migrations/20261104012000_branch_bonus_commands.sql','utf8');
    const oldWriter=commands.slice(commands.indexOf('create or replace function public.confirm_branch_bonus('),commands.indexOf('create or replace function public.delete_branch_bonus('));
    expect(oldWriter).toContain('insert into public.branch_bonuses');
    sql(db,oldWriter);
    const fixture=readFileSync('supabase/tests/branch_bonus_test.sql','utf8');
    const records=fixture.slice(fixture.indexOf('insert into public.locations'),fixture.indexOf('set constraints all immediate;'));
    const oldId='b0070000-0000-4000-8000-000000000777';
    const seeded=spawnSync('docker',args(db),{input:`begin;${records}set constraints all immediate;${auth}
      select public.confirm_branch_bonus('${branch}','${oldId}','${input()}',public.preview_branch_bonus('${branch}','${input()}')->>'sourceFingerprint');commit;`,windowsHide:true});
    expect(seeded.status,seeded.stderr.toString()).toBe(0);
    const before=sql(db,`select snapshot::text from public.branch_bonuses where id='${oldId}'`);
    expect(sql(db,"select to_regprocedure('public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)')"),"upgrade must begin without the new batch entrypoint").toBe('');
    ensureBonusBatchSchema(container,db);
    expect(sql(db,`select snapshot::text from public.branch_bonuses where id='${oldId}'`)).toBe(before);
    const expected=JSON.parse(before).sourceFingerprint;
    expect(sql(db,`begin;${auth}select public.confirm_branch_bonus('${branch}','${oldId}','${input()}','${expected}')->>'id';rollback;`).split('\n').at(-1)).toBe(oldId);
    expect(()=>sql(db,`begin;${auth}select public.confirm_branch_bonus('${branch}','${crypto.randomUUID()}','${input()}','${expected}');rollback;`)).toThrow(/BONUS_SOURCE_CHANGED/);
    sql(db,`begin;${auth}delete from public.branch_bonuses where location_id='${branch}';delete from private.branch_bonus_request_receipts;
      delete from public.rubber_bills where source_rubber_export_id is not null;
      delete from public.rubber_exports where id<>'${rex}';commit;`);
  });
  test.afterAll(()=>{
    if(!/^branch_bonus_test_[a-f0-9]{32}$/.test(db??''))return;
    sql('postgres',`select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}'`);
    execFileSync('docker',['exec',container,'dropdb','-U','postgres',db],{windowsHide:true});
  });
  test.beforeEach(()=>sql(db,`begin;${auth}delete from public.branch_bonuses where location_id='${branch}';delete from private.branch_bonus_batches;
    select public.set_rubber_export_sold_out('${rex}',true);commit;`));
  test('two identical requests return one batch and one result',async()=>{
    const payload=preview(),id=crypto.randomUUID(),holder=session();holder.send(`select pg_advisory_xact_lock(hashtextextended('${branch}',0));select 'HELD';`);await holder.wait('HELD');
    const a=session(),b=session();a.finish(confirm(id,payload)+'commit;');await blocked(id);b.finish(confirm(id,payload)+'commit;');holder.finish('commit;');
    const results=await Promise.all([holder.done,a.done,b.done]);for(const result of results)expect(result.code,result.stderr).toBe(0);
    expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('1');expect(sql(db,'select count(*) from private.branch_bonus_batches')).toBe('1');
  });
  test('two different requests cannot both consume the mandatory inventory',async()=>{
    const payload=preview(),idA=crypto.randomUUID(),idB=crypto.randomUUID(),holder=session();holder.send(`select pg_advisory_xact_lock(hashtextextended('${branch}',0));select 'HELD';`);await holder.wait('HELD');
    const a=session(),b=session();a.finish(confirm(idA,payload)+'commit;');await blocked(idA);b.finish(confirm(idB,payload)+'commit;');await blocked(idB);holder.finish('commit;');
    const results=await Promise.all([a.done,b.done]);await holder.done;expect(results.filter(r=>r.code===0)).toHaveLength(1);expect(results.find(r=>r.code!==0)?.stderr).toContain('BONUS_SOURCE_CHANGED');
    expect(results.map(r=>r.stderr).join()).not.toContain('deadlock');expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('1');
  });
  test('history exits before waiting confirmation and leaves no batch',async()=>{
    const payload=preview(),id=crypto.randomUUID(),source=session();source.send(`select public.set_rubber_export_sold_out('${rex}',false);select 'EXIT';`);await source.wait('EXIT');
    const save=session();save.finish(confirm(id,payload)+'commit;');await blocked(id);source.finish('commit;');
    const result=await save.done;await source.done;expect(result.code).not.toBe(0);expect(result.stderr).toContain('BONUS_SOURCE_CHANGED');
    expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('0');expect(sql(db,'select count(*) from private.branch_bonus_batches')).toBe('0');
  });
  test('confirmation wins and the concurrent source cannot leave history',async()=>{
    const payload=preview(),save=session();save.send(confirm(crypto.randomUUID(),payload)+"select 'SAVED';");await save.wait('SAVED');
    const source=session();source.finish(`select public.set_rubber_export_sold_out('${rex}',false);commit;`);save.finish('commit;');
    const [a,b]=await Promise.all([save.done,source.done]);expect(a.code,a.stderr).toBe(0);expect(b.code).not.toBe(0);expect(b.stderr).toMatch(/BONUS_(HISTORY_LOCKED|SOURCE_CHANGED)/);
  });
  test('a new REX committed while confirmation waits cannot be silently skipped',async()=>{
    const payload=preview(),id=crypto.randomUUID(),next=crypto.randomUUID(),source=session();
    source.send(`insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
      'id','${next}','export_no','REX-CONCURRENT-${next}','sequence_no',104))).* from public.rubber_exports e where id='${rex}';select 'INSERTED';`);
    await source.wait('INSERTED');const save=session();save.finish(confirm(id,payload)+'commit;');await blocked(id);source.finish('commit;');
    const result=await save.done;await source.done;expect(result.code).not.toBe(0);expect(result.stderr).toContain('BONUS_SOURCE_CHANGED');
    expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('0');expect(sql(db,'select count(*) from private.branch_bonus_batches')).toBe('0');
  });
});
