// Read-only Cloud export. No restore, production mutation, login or worker call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';

const ref = fs.readFileSync('supabase/.temp/project-ref','utf8').trim();
const credentials = parse(fs.readFileSync('.env.production.local'));
assert.equal(new URL(credentials.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
assert.ok(credentials.SUPABASE_DB_PASSWORD, 'Cloud DB credential is required');
const pooler = new URL(fs.readFileSync('supabase/.temp/pooler-url','utf8').trim());
assert.ok(pooler.hostname.endsWith('.pooler.supabase.com'));
const env = { ...process.env, PGHOST: pooler.hostname, PGPORT:'5432', PGUSER:`postgres.${ref}`,
  PGDATABASE:'postgres', PGPASSWORD:credentials.SUPABASE_DB_PASSWORD, PGSSLMODE:'require',
  PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=300000' };
const prefix = ['exec','-i',...['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGOPTIONS'].flatMap(k=>['-e',k]),'supabase_db_webapp'];
const directory = path.resolve('output/production-backups',`rubber-sync-${new Date().toISOString().replaceAll(':','-')}`);
assert.ok(directory.startsWith(path.resolve('output/production-backups')+path.sep));
fs.mkdirSync(directory,{recursive:true});
function run(args,input,file) {
  return new Promise((resolve,reject)=>{
    const fd = file ? fs.openSync(path.join(directory,file),'wx') : undefined;
    const child = spawn('docker',[...prefix,...args],{env,windowsHide:true,stdio:['pipe',fd??'pipe','pipe']});
    let result='', diagnostics='';
    child.stdout?.on('data',chunk=>{ result+=chunk; });
    child.stderr.on('data',chunk=>{ diagnostics+=chunk; });
    child.on('error',reject);
    child.on('close',code=>{
      if(fd!==undefined) fs.closeSync(fd);
      if(code!==0) {
        fs.writeFileSync(path.join(directory,'export-error.log'),diagnostics,{mode:0o600});
        reject(new Error('Cloud read-only export failed; private diagnostics saved beside snapshot'));
      } else resolve(result.trim());
    });
    child.stdin.end(input);
  });
}
const psql=['psql','-X','-q','-At','-v','ON_ERROR_STOP=1'];
const holder=spawn('docker',[...prefix,...psql],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let diagnostics=''; holder.stderr.on('data',b=>{diagnostics+=b;});
const snapshot=await new Promise((resolve,reject)=>{
  let buffer='';
  holder.stdout.on('data',chunk=>{buffer+=chunk; if(buffer.includes('\n')) resolve(buffer.trim().split('\n')[0]);});
  holder.on('error',reject);
  holder.on('exit',()=>reject(new Error('Cloud snapshot session ended before export')));
  holder.stdin.write('begin isolation level repeatable read read only; select pg_export_snapshot();\n');
});
assert.match(snapshot,/^[0-9A-F-]+$/i);
const read = query => `begin isolation level repeatable read read only; set transaction snapshot '${snapshot}'; ${query}; commit;`;
try {
  const inventory=JSON.parse(await run(psql,read(`select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) order by schemaname,tablename)
      from pg_tables where schemaname in ('public','private')),
    'profileColumns',(select jsonb_agg(column_name order by ordinal_position) from information_schema.columns
      where table_schema='public' and table_name='profiles'),
    'migration',(select max(version) from supabase_migrations.schema_migrations),
    'extensions',(select jsonb_agg(extname order by extname) from pg_extension))`)));
  const ident = value => '"'+value.replaceAll('"','""')+'"';
  const tableCounts=JSON.parse(await run(psql,read(`select jsonb_object_agg(name,n) from (
    ${inventory.tables.map(t=>`select '${t.schema}.${t.table}' name,count(*) n from ${ident(t.schema)}.${ident(t.table)}`).join(' union all ')}
    ) totals`)));
  await run(['pg_dump','--format=custom','--no-owner','--no-privileges','--schema=public','--schema=private',
    '--exclude-table-data=public.profiles',`--snapshot=${snapshot}`],undefined,'business.dump');
  const columns=inventory.profileColumns.filter(c=>!/password/i.test(c));
  await run(psql,read(`copy (select ${columns.map(ident).join(',')} from public.profiles order by id) to stdout with (format csv,header true)`),'profiles-without-passwords.csv');
  await run(psql,read('copy (select id from auth.users order by id) to stdout with (format csv,header true)'),'auth-user-ids-only.csv');
  await run(psql,read('select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m'),'migration-history.json');
  const receipts=[];
  for(const name of ['business.dump','profiles-without-passwords.csv','auth-user-ids-only.csv','migration-history.json']) {
    const hash=createHash('sha256');
    for await(const bytes of fs.createReadStream(path.join(directory,name))) hash.update(bytes);
    const bytes=fs.statSync(path.join(directory,name)).size;
    assert.ok(bytes>0);
    receipts.push({name,bytes,sha256:hash.digest('hex')});
  }
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({sourceProject:ref,readOnly:true,
    consistentSnapshot:true,scope:['public','private'],auth:'IDs only; no credentials or sessions',
    profilePasswordFieldsExcluded:inventory.profileColumns.filter(c=>/password/i.test(c)),
    inventory,tableCounts,receipts},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({directory,tables:inventory.tables.length,
    rows:Object.values(tableCounts).reduce((a,b)=>a+Number(b),0),migration:inventory.migration,receipts}));
} finally {
  holder.stdin.end('rollback;\n');
  if(diagnostics) fs.writeFileSync(path.join(directory,'snapshot-session.log'),diagnostics,{mode:0o600});
}
