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
  metrics: { burden: { weight: 50, target: 5 }, loss: { weight: 40, target: 10 }, counts: { weight: 10, target: 10 }, age: { weight: 0, target: null } } });
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
  function referenceFixture(){
    const location=crypto.randomUUID(),exportId=crypto.randomUUID();
    sql(db,`begin;${auth}delete from public.rubber_exports where location_id='${branch}' and id<>'${rex}';
      insert into public.locations(id,name,code) values('${location}','Concurrent reference ${location}','R${location.slice(0,7)}');
      insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
        'id','${exportId}','location_id','${location}','export_no','REF-${exportId}','sequence_no',105,'current_weight',original_weight_total*.98))).*
        from public.rubber_exports e where id='${rex}';commit;`);
    const cleanup=()=>sql(db,`begin;${auth}delete from public.branch_bonuses where location_id in ('${branch}','${location}');
      delete from private.branch_bonus_batches;delete from public.rubber_exports where location_id='${location}';update public.locations set is_active=false where id='${location}';commit;`);
    return {location,exportId,cleanup};
  }
  test('external history committed before the reference snapshot invalidates a waiting confirmation',async()=>{
    const ref=referenceFixture();
    try{
      const payload=preview(),id=crypto.randomUUID(),holder=session();holder.send(`select pg_advisory_xact_lock(hashtextextended('${branch}',0));select 'HELD';`);await holder.wait('HELD');
      const save=session();save.finish(confirm(id,payload)+'commit;');await blocked(id);
      sql(db,`begin;${auth}select public.set_rubber_export_sold_out('${ref.exportId}',false);commit;`);holder.finish('commit;');
      const result=await save.done;await holder.done;expect(result.code).not.toBe(0);expect(result.stderr).toContain('BONUS_SOURCE_CHANGED');
      expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('0');
    }finally{ref.cleanup();}
  });
  test('two branches holding their own locks confirm against the shared snapshot without a lock cycle',async()=>{
    const ref=referenceFixture();
    try{
      const first=preview();
      const review=JSON.parse(sql(db,`begin;${auth}select public.review_branch_bonus('${ref.location}');rollback;`).split('\n').at(-1)!);
      const settings=JSON.parse(input());settings.metrics.burden.weight=0;settings.metrics.counts.weight=0;settings.metrics.loss.weight=100;
      const parts=[{key:review.periods[0].key,input:{...settings,exportIds:[ref.exportId]}}];
      const result=JSON.parse(sql(db,`begin;${auth}select public.preview_branch_bonus_batch('${ref.location}','${review.fingerprint}','${JSON.stringify(parts)}');rollback;`).split('\n').at(-1)!);
      expect(result.periods[0].preview.canConfirm,result.periods[0].preview.issues.join(", ")).toBe(true);
      const second=parts.map(p=>({...p,expected:result.periods[0].preview.sourceFingerprint}));
      const a=session(),b=session();a.send(`select pg_advisory_xact_lock(hashtextextended('${branch}',0));select 'A';`);
      b.send(`select pg_advisory_xact_lock(hashtextextended('${ref.location}',0));select 'B';`);await Promise.all([a.wait('A'),b.wait('B')]);
      a.finish(confirm(crypto.randomUUID(),first)+'commit;');
      b.finish(`select public.confirm_branch_bonus_batch('${ref.location}','${crypto.randomUUID()}','${review.fingerprint}','${JSON.stringify(second)}');commit;`);
      const outcomes=await Promise.all([a.done,b.done]);for(const outcome of outcomes)expect(outcome.code,outcome.stderr).toBe(0);
      expect(sql(db,'select count(*) from public.branch_bonuses')).toBe('2');
    }finally{ref.cleanup();}
  });
  test('an external commit after context capture cannot mix new reference data into the saved snapshot',async()=>{
    const ref=referenceFixture(),holder=session();let released=false;
    try{
      const payload=preview(),id=crypto.randomUUID();
      const originalTarget=JSON.parse(sql(db,`begin;${auth}select public.preview_branch_bonus_batch('${branch}','${payload.review}','${JSON.stringify(payload.periods)}');rollback;`).split('\n').at(-1)!).periods[0].preview.reference.lossTarget;
      sql(db,`create function public.reference_snapshot_probe() returns trigger language plpgsql as $probe$ begin
        if new.location_id='${branch}' then perform pg_advisory_xact_lock(923711);end if;return new;end $probe$;
        create trigger reference_snapshot_probe before insert on public.branch_bonuses for each row execute function public.reference_snapshot_probe();`);
      holder.send("select pg_advisory_xact_lock(923711);select 'PROBE';");await holder.wait('PROBE');
      const save=session();save.finish(confirm(id,payload)+'commit;');await blocked(id);
      sql(db,`begin;${auth}select public.set_rubber_export_sold_out('${ref.exportId}',false);
        select public.adjust_rubber_export_weight(id,original_weight_total*.95,current_weight) from public.rubber_exports where id='${ref.exportId}';
        select public.set_rubber_export_sold_out('${ref.exportId}',true);commit;`);
      holder.finish('commit;');released=true;await holder.done;const result=await save.done;expect(result.code,result.stderr).toBe(0);
      expect(Number(sql(db,`select (snapshot->'reference'->>'lossTarget')::numeric from public.branch_bonuses where location_id='${branch}'`))).toBe(originalTarget);
    }finally{
      if(!released){holder.finish('rollback;');await holder.done;}
      sql(db,'drop trigger if exists reference_snapshot_probe on public.branch_bonuses;drop function if exists public.reference_snapshot_probe();');ref.cleanup();
    }
  });
});
