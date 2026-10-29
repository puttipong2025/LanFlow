// Catalog/source audit only; no business rows or mutations.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
const rows = JSON.parse(execFileSync('docker', ['exec','-i','supabase_db_webapp','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'], {
  input: `begin read only;select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f';commit;`,
  encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,
}));
const byName=Object.groupBy(rows,r=>`${r.schema}.${r.name}`);
const roots=['public.submit_rubber_queue','public.manage_rubber_queue','private.process_rubber_queue',
  'public.wake_rubber_queue','public.sync_rubber_bill','public.approve_rubber_bill_approval_request',
  'public.delete_rubber_bill_approval_request','public.create_report_batch','public.start_cash_count_session'];
const visited=new Set(),pending=[...roots],functions=[];
while(pending.length) {
  const name=pending.shift();if(visited.has(name))continue;visited.add(name);
  for(const row of byName[name]??[]) {
    const calls=[...row.definition.matchAll(/\b(public|private)\.([a-z_][a-z_0-9]*)\s*\(/g)]
      .map(match=>`${match[1]}.${match[2]}`).filter(call=>call!==name&&byName[call]);
    pending.push(...calls);
    functions.push({signature:row.signature,sha256:createHash('sha256').update(row.definition).digest('hex'),calls:[...new Set(calls)],
      locks:row.definition.split('\n').flatMap((line,index)=>/advisory.*lock|for (?:no key )?update|for share/i.test(line)
        ? [{line:index+1,code:line.trim()}]:[]),
      resourceReferences:[...new Set([...row.definition.matchAll(/public\.(rubber_bill_numbers|rubber_bill_items|rubber_bills|acid_stock_movements|stock_movements|stock_products|money_transfers|money_transfer_items|report_items|cash_count_sessions)\b/g)].map(m=>m[1]))]});
  }
}
mkdirSync('output',{recursive:true});
writeFileSync('output/rubber-sync-lock-callgraph.json',JSON.stringify({roots,functions,
  limitation:'Function call graph is static source evidence. Trigger/FK locks and runtime waits require the actual SQL/concurrency tests.'},null,2));
console.log(JSON.stringify({roots:roots.length,functions:functions.length,functionsWithLocks:functions.filter(f=>f.locks.length).length}));
