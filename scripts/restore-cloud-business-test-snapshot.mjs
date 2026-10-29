// Restore only into the dedicated offline database, never the app Local DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const container='lanflow-rubber-realdata-20261029';
const resume=process.argv.includes('--resume-post-data');
const directory=path.resolve(process.argv[2]??'');
assert.ok(directory.startsWith(path.resolve('output/production-backups')+path.sep));
assert.equal(execFileSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container],{encoding:'utf8'}).trim(),'none');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
assert.equal(manifest.readOnly,true); assert.equal(manifest.consistentSnapshot,true);
for(const receipt of manifest.receipts) {
  const hash=createHash('sha256');
  for await(const bytes of fs.createReadStream(path.join(directory,receipt.name))) hash.update(bytes);
  assert.equal(hash.digest('hex'),receipt.sha256); assert.equal(fs.statSync(path.join(directory,receipt.name)).size,receipt.bytes);
}
function run(args,input) {
  const result=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
  if(result.status!==0) {
    fs.writeFileSync(path.join(directory,'isolated-restore-error.log'),result.stderr??'',{mode:0o600});
    throw new Error('Isolated restore failed; private diagnostics saved beside snapshot');
  }
  return result.stdout.trim();
}
const sql=query=>run(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],query);
assert.equal(sql('show cron.launch_active_jobs'),'off');
if(!resume) assert.equal(sql("select count(*) from pg_tables where schemaname in ('public','private')"),'0','Restore requires a fresh empty isolated DB');
for(const name of ['business.dump','profiles-without-passwords.csv','auth-user-ids-only.csv']) run(['cp',path.join(directory,name),`${container}:/tmp/${name}`]);
sql(`create extension if not exists moddatetime with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;`);
const toc=run(['exec',container,'pg_restore','--list','/tmp/business.dump']).split('\n')
  .filter(line=>!line.includes(' SCHEMA - public ')&&!line.includes(' COMMENT - SCHEMA public ')).join('\n');
fs.writeFileSync(path.join(directory,'restore-toc.list'),toc);
run(['cp',path.join(directory,'restore-toc.list'),`${container}:/tmp/restore-toc.list`]);
const restore=section=>run(['exec',container,'pg_restore','--exit-on-error','--single-transaction','--no-owner','--no-privileges',
  ...(resume&&section==='post-data'?['--clean','--if-exists']:[]),
  `--section=${section}`,'--use-list=/tmp/restore-toc.list','-U','supabase_admin','-d','postgres','/tmp/business.dump']);
if(!resume) {
restore('pre-data');
sql("set session_replication_role=replica;copy auth.users(id) from '/tmp/auth-user-ids-only.csv' with (format csv,header true);");
const columns=manifest.inventory.profileColumns.filter(c=>!/password/i.test(c));
assert.ok(columns.every(c=>/^[a-z_]+$/.test(c)));
sql(`set session_replication_role=replica;copy public.profiles(${columns.map(c=>'"'+c+'"').join(',')}) from '/tmp/profiles-without-passwords.csv' with (format csv,header true);`);
restore('data');
}
// Inert IDs satisfy business FKs; these are not real Auth sessions and cannot log in.
sql(`create table if not exists auth.sessions(id uuid primary key);
insert into auth.sessions(id) select session_id from private.browser_session_approvals on conflict do nothing;`);
restore('post-data');
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const counts=JSON.parse(sql(`select jsonb_object_agg(name,n) from (${manifest.inventory.tables.map(t=>
  `select '${t.schema}.${t.table}' name,count(*) n from ${ident(t.schema)}.${ident(t.table)}`).join(' union all ')}) totals`));
assert.deepEqual(counts,manifest.tableCounts,'All business table row counts must match the snapshot');
const passwordColumns=manifest.profilePasswordFieldsExcluded;
assert.equal(sql(`select count(*) from public.profiles where ${passwordColumns.map(c=>ident(c)+' is not null').join(' or ')}`),'0');
assert.equal(sql('show cron.launch_active_jobs'),'off');
const receipt={container,network:'none',cron:'off',tables:Object.keys(counts).length,
  rows:Object.values(counts).reduce((a,b)=>a+Number(b),0),allTableCountsMatch:true,
  profilePasswordFieldsNull:true,authSessionsCopied:false,authSessionForeignKeys:'inert ID placeholders only'};
fs.writeFileSync(path.join(directory,'restore-verification.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
