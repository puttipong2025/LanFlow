// Offline real-data clone only; all function/temporary-table changes roll back.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const candidate=fs.readFileSync('supabase/migrations/20261030021000_rubber_feed_page_decoration.sql','utf8');
const control=fs.readFileSync('scripts/rollback-rubber-feed-page-decoration.sql','utf8');
const reversed=process.argv.includes('--reversed');
const fixture=fs.readFileSync('supabase/tests/rubber_feed_page_decoration_test.sql','utf8')
  .split('create temporary sequence feed_decoration_calls;')[0].replace(/^begin;\r?$/m,'')
  .replace(/^select extensions.no_plan\(\);\r?$/m,'');
const assertDefinition=isCandidate=>`do $definition$ begin
if (position('decorated as (' in pg_get_functiondef('public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure))>0) is distinct from ${isCandidate}
then raise exception 'Wrong seven-argument feed installed for this comparison stage';end if;
end $definition$;`;
const run=input=>execFileSync('docker',['exec','-i','lanflow-rubber-realdata-20261029','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
assert.equal(execFileSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}','lanflow-rubber-realdata-20261029'],{encoding:'utf8'}).trim(),'none');
const sql=`begin;set local statement_timeout='300s';
${fixture}
insert into public.rubber_bill_approval_requests(operation,bill_id,location_id,client_temp_id,idempotency_key,
base_revision_no,matched_reasons,original_payload,proposed_payload,requested_by_user_id,requested_by_name,requested_by_phone)
select op,case when op='create' then null else b.id end,'af200000-0000-4000-8000-000000000010',
case when op='create' then 'feed-page-create' else b.client_temp_id end,'feed-page-approval-'||op,1,array['price'],case when op='create' then null::jsonb else '{}'::jsonb end,
jsonb_build_object('customerName','Proposed page probe','billDate',current_date,'billType','weighing','netWeight',100,
'averagePrice',39,'netRubberValue',3900,'deductionTotal',0,'netTotal',3900,'items',jsonb_build_array(jsonb_build_object(
'itemType','weigh','title','Weigh','inWeight',100,'outWeight',0,'netWeight',100,'unitPrice',39,'sequenceNo',1))),
'af200000-0000-4000-8000-000000000001','Feed page probe','fixture'
from unnest(array['create','update','delete'])op join public.rubber_bills b
on b.client_temp_id=case when op='delete' then 'feed-page-219' else 'feed-page-220' end;
${reversed?candidate:control}
${assertDefinition(reversed)}
create temp table feed_cases(id serial,branch uuid,mode text,doc text,search text,size integer,cursor_at timestamptz,cursor_id text,expected jsonb,control_ms numeric,candidate_ms numeric);
insert into feed_cases(branch,mode,doc,search,size)
select b.location_id,m,d,s,n from (select location_id from public.rubber_bills group by location_id order by count(*) desc limit 3)b
cross join unnest(array['latest','unpriced','pending_approval'])m cross join unnest(array['any','editable','report_locked','in_transfer'])d
cross join unnest(array['','no-such-synthetic-search'])s cross join unnest(array[1,100])n;
insert into feed_cases(branch,mode,doc,search,size)
select 'af200000-0000-4000-8000-000000000010',m,d,s,n
from unnest(array['latest','unpriced','pending_approval'])m cross join unnest(array['any','editable','report_locked','in_transfer'])d
cross join unnest(array['','proposed','no-such-synthetic-search'])s cross join unnest(array[1,100])n;
do $control$ declare c record; started timestamptz; payload jsonb; begin
for c in select * from feed_cases order by id loop
started:=clock_timestamp();payload:=public.get_rubber_bill_operational_feed_v2(c.branch,c.mode,c.doc,c.search,null,null,c.size);
update feed_cases set expected=payload,control_ms=extract(epoch from clock_timestamp()-started)*1000 where id=c.id;
if payload->>'hasMore'='true' then insert into feed_cases(branch,mode,doc,search,size,cursor_at,cursor_id)
values(c.branch,c.mode,c.doc,c.search,c.size,(payload->>'nextSortAt')::timestamptz,payload->>'nextWorkIdentity');end if;
end loop;
for c in select * from feed_cases where expected is null order by id loop
started:=clock_timestamp();payload:=public.get_rubber_bill_operational_feed_v2(c.branch,c.mode,c.doc,c.search,c.cursor_at,c.cursor_id,c.size);
update feed_cases set expected=payload,control_ms=extract(epoch from clock_timestamp()-started)*1000 where id=c.id;
end loop;end $control$;
${reversed?control:candidate}
${assertDefinition(!reversed)}
do $candidate$ declare c record; started timestamptz; payload jsonb; begin
for c in select * from feed_cases order by id loop
started:=clock_timestamp();payload:=public.get_rubber_bill_operational_feed_v2(c.branch,c.mode,c.doc,c.search,c.cursor_at,c.cursor_id,c.size);
if payload is distinct from c.expected then raise exception 'Feed response mismatch case % mode % doc % size %',c.id,c.mode,c.doc,c.size;end if;
update feed_cases set candidate_ms=extract(epoch from clock_timestamp()-started)*1000 where id=c.id;
end loop;end $candidate$;
select jsonb_build_object('cases',count(*),'controlMs',sum(control_ms),'candidateMs',sum(candidate_ms),
 'modes',(select jsonb_agg(x) from(select mode,count(*),sum(control_ms) control_ms,sum(candidate_ms) candidate_ms from feed_cases group by mode)x)) from feed_cases;
rollback;`;
const lines=run(sql).trim().split('\n');const result=JSON.parse(lines.at(-1));
if(reversed){[result.controlMs,result.candidateMs]=[result.candidateMs,result.controlMs];
for(const mode of result.modes)[mode.control_ms,mode.candidate_ms]=[mode.candidate_ms,mode.control_ms];}
result.order=reversed?'candidate-then-control':'control-then-candidate';
result.environment='Offline real-data clone, three largest branches plus synthetic mixed pending approvals, complete JSON differential in one rollback transaction; no network/UI timing.';
fs.writeFileSync('output/rubber-feed-page-differential'+(reversed?'-reversed':'')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
