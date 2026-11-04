import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export function ensureBonusBatchSchema(container: string, database: string) {
  const args=["exec","-i",container,"psql","-X","-q","-At","-v","ON_ERROR_STOP=1","-U","supabase_admin","-d",database];
  const query=(statement:string)=>execFileSync("docker",[...args,"-c",statement],{encoding:"utf8",windowsHide:true}).trim();
  if(query("select to_regprocedure('public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)')"))return;
  const hasBase=!!query("select to_regclass('public.branch_bonuses')");
  const files=readdirSync("supabase/migrations").filter(f=>f.startsWith("20261104")&&f.endsWith(".sql")&&(!hasBase||f>="20261104016000" )).sort();
  for(const file of files){
    const result=spawnSync("docker",args,{input:readFileSync(`supabase/migrations/${file}`),windowsHide:true});
    if(result.status!==0)throw new Error(`${file}: ${result.stderr}`);
  }
  if(!query("select to_regprocedure('public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)')"))throw new Error("Batch migration missing from test database");
}
