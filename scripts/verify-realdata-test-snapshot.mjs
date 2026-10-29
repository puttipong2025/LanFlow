import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const container='lanflow-rubber-realdata-20261029';
const directory=path.resolve(process.argv[2]??'');
assert.ok(directory.startsWith(path.resolve('output/production-backups')+path.sep));
assert.equal(execFileSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container],{encoding:'utf8'}).trim(),'none');
function sql(input) {
  try { return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
    {input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim(); }
  catch { throw new Error('Snapshot verification query failed; no business rows emitted'); }
}
assert.equal(sql('show cron.launch_active_jobs'),'off');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const fingerprints=JSON.parse(sql(`begin read only;set local statement_timeout='120s';select jsonb_object_agg(name,fingerprint) from (
  ${manifest.inventory.tables.map(t=>`select '${t.schema}.${t.table}' name,jsonb_build_array(count(*),
    md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) fingerprint
    from ${ident(t.schema)}.${ident(t.table)} t`).join(' union all ')}
  ) fingerprints;commit;`));
const baseline=path.join(directory,'test-baseline-fingerprints.json');
if(process.argv.includes('--capture')) {
  fs.writeFileSync(baseline,JSON.stringify(fingerprints,null,2),{flag:'wx'});
  console.log(JSON.stringify({capturedTables:Object.keys(fingerprints).length}));
} else {
  assert.deepEqual(fingerprints,JSON.parse(fs.readFileSync(baseline,'utf8')),'All business tables must remain unchanged after rollback-only tests');
  sql(`do $check$ declare c record; violations bigint; begin
    for c in select co.conname,co.conrelid::regclass child,co.confrelid::regclass parent,
      string_agg(format('c.%I is not null',ca.attname),' and ' order by k.n) nonnull,
      string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by k.n) matches
      from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace ns on ns.oid=cl.relnamespace
      cross join lateral unnest(co.conkey,co.confkey) with ordinality k(childnum,parentnum,n)
      join pg_attribute ca on ca.attrelid=co.conrelid and ca.attnum=k.childnum
      join pg_attribute pa on pa.attrelid=co.confrelid and pa.attnum=k.parentnum
      where co.contype='f' and ns.nspname in ('public','private') group by co.oid,co.conname,co.conrelid,co.confrelid
    loop
      execute format('select count(*) from %s c where %s and not exists(select 1 from %s p where %s)',c.child,c.nonnull,c.parent,c.matches) into violations;
      if violations<>0 then raise exception 'Foreign-key data mismatch'; end if;
    end loop;
  end $check$;`);
  const receipt={unchangedBusinessTables:Object.keys(fingerprints).length,foreignKeyViolations:0,network:'none',cron:'off'};
  fs.writeFileSync(path.join(directory,'test-preservation-verification.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}
