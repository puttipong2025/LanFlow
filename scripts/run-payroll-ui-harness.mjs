// Isolated browser fixture, using the real payroll components and styles.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const fixture = path.join(os.tmpdir(), "lanflow-payroll-ui-harness");
fs.mkdirSync(path.join(fixture, "app"), { recursive: true });
const modules = path.join(fixture, "node_modules");
if (!fs.existsSync(modules)) fs.symlinkSync(path.join(root,"node_modules"), modules, "junction");
if (!fs.existsSync(path.join(fixture,"src"))) fs.symlinkSync(path.join(root,"src"),path.join(fixture,"src"),"junction");
fs.writeFileSync(path.join(fixture,"package.json"), '{"private":true}');
fs.writeFileSync(path.join(fixture,"next.config.mjs"), `export default { outputFileTracingRoot: ${JSON.stringify(root)} };`);
fs.writeFileSync(path.join(fixture,"tsconfig.json"), JSON.stringify({ compilerOptions: {
  target:"ES2017",lib:["dom","esnext"],skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,
  module:"esnext",moduleResolution:"bundler",jsx:"preserve",baseUrl:".",paths:{"@/*":["./src/*"]},
},include:["app/**/*.tsx"] }));
fs.copyFileSync(path.join(root,"postcss.config.js"),path.join(fixture,"postcss.config.js"));
fs.copyFileSync(path.join(root,"tailwind.config.ts"),path.join(fixture,"tailwind.config.ts"));
fs.writeFileSync(path.join(fixture,"app/layout.tsx"), `import ${JSON.stringify(path.join(root,"src/app/globals.css").replaceAll("\\","/"))}; export default function Layout({children}:{children:React.ReactNode}) {return <html><body>{children}</body></html>}`);
let managerImport = "@/components/time-tracking/manager/ManagerWorkspace";
if (process.env.PAYROLL_UI_BASELINE === "1") {
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "src/components/time-tracking"], { encoding:"utf8" }).trim().split("\n");
  for (const file of files) {
    const target = path.join(fixture,"baseline",file.slice("src/components/".length));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,execFileSync("git",["show",`HEAD:${file}`]));
  }
  managerImport = "../baseline/time-tracking/manager/ManagerWorkspace";
}
fs.writeFileSync(path.join(fixture,"app/page.tsx"), `"use client";
import {useActionableBadges} from "@/hooks/useActionableBadges";
import {QueryProvider} from "@/components/QueryProvider";
import {PayrollRefresh} from "@/components/time-tracking/PayrollRefresh";
import {ManagerWorkspace} from ${JSON.stringify(managerImport)};
import type {Profile} from "@/types";
const profile = {id:"7ef10000-0000-4000-8000-000000000020",name:"Test Manager",role:"super_admin",locationIds:[]} as Profile;
function Badge(){const {counts,error}=useActionableBadges(true,false);return <output aria-label="จำนวนงาน">{error?"โหลดจำนวนงานล่าสุดไม่ได้":counts.branch?.["time-tracking"]??0}</output>;}
export default function Page(){return <QueryProvider><Badge/><button>เวลาและเงินเดือน</button><PayrollRefresh online ownerUserId={profile.id}><ManagerWorkspace profile={profile} online locations={[]}/></PayrollRefresh></QueryProvider>}`);
const child = spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"dev",fixture,"-p","3017"],{
  stdio:"inherit",windowsHide:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:55421",NEXT_PUBLIC_SUPABASE_ANON_KEY:"payroll-fixture"},
});
process.on("SIGTERM",()=>child.kill()); process.on("SIGINT",()=>child.kill());
child.on("exit",code=>process.exit(code??1));
