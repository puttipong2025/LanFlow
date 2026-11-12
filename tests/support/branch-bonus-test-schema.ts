import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export function ensureBonusBatchSchema(container: string, database: string) {
  const args=["exec","-i",container,"psql","-X","-q","-At","-v","ON_ERROR_STOP=1","-U","supabase_admin","-d",database];
  const query=(statement:string)=>execFileSync("docker",[...args,"-c",statement],{encoding:"utf8",windowsHide:true}).trim();
  const hasBatch=!!query("select to_regprocedure('public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)')");
  const hasBase=!!query("select to_regclass('public.branch_bonuses')");
  const hasAge=hasBase&&query("select position('branch-bonus-v3' in pg_get_functiondef('private.branch_bonus_calculate(uuid,jsonb,timestamptz)'::regprocedure))::integer>0")==="t";
  if(hasBatch&&hasAge)return;
  const files=readdirSync("supabase/migrations").filter(f=>f.includes("_branch_bonus_")&&f.endsWith(".sql")
    &&(!hasBase||(!hasBatch&&f==="20261104016000_branch_bonus_batches.sql")||((!hasAge||!hasBatch)&&f>"20261104016000_branch_bonus_batches.sql"))).sort();
  for(const file of files){
    const result=spawnSync("docker",args,{input:readFileSync(`supabase/migrations/${file}`),windowsHide:true});
    if(result.status!==0)throw new Error(`${file}: ${result.stderr}`);
  }
  if(!query("select to_regprocedure('public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)')"))throw new Error("Batch migration missing from test database");
  if(query("select position('branch-bonus-v3' in pg_get_functiondef('private.branch_bonus_calculate(uuid,jsonb,timestamptz)'::regprocedure))::integer>0")!=="t")throw new Error("Verified age formula missing from test database");
}
