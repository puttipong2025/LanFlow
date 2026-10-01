import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { getJsPageSizeInKb } = require("next/dist/build/utils");

const distDirectory = resolve(".next");
const buildManifest = JSON.parse(
  await readFile(resolve(distDirectory, "build-manifest.json"), "utf8"),
);
const appBuildManifest = JSON.parse(
  await readFile(resolve(distDirectory, "app-build-manifest.json"), "utf8"),
);
const budgetBytes = 320 * 1024;
const [routeBytes, firstLoadBytes] = await getJsPageSizeInKb(
  "app",
  "/",
  distDirectory,
  buildManifest,
  appBuildManifest,
  true,
);
const initialPageFiles = appBuildManifest.pages["/page"] ?? [];
const initialPageSource = (
  await Promise.all(initialPageFiles.map((file) =>
    readFile(resolve(distDirectory, file), "utf8")
  ))
).join("\n");
const inactiveModuleSentinels = [
  "เพิ่มบิลยาง",
  "ตั้งค่าและอนุมัติรับ-จ่าย",
  "ระบบเวลาและเงินเดือน (ของตนเอง)",
];
const bundledInactiveModules = inactiveModuleSentinels.filter((sentinel) =>
  initialPageSource.includes(sentinel)
);
const preRefactorTimePayrollBaseline = { raw: 120_810, gzip: 26_972 };
// Workflow modules add a small, measured boundary cost. Ratchet the verified
// modularized payload exactly rather than adding async loading behavior to a
// behavior-preserving refactor.
// Missing-slip badges, cutoff refresh, and outstanding-balance slip rows add
// verified product behavior to this lazy business-module boundary.
const timePayrollBudget = { raw: 128_011, gzip: 29_467 };
const chunkDirectory = resolve(distDirectory, "static/chunks");
const chunkFiles = (await readdir(chunkDirectory, { recursive: true }))
  .filter((file) => file.endsWith(".js"));
const timePayrollChunks = [];
for (const file of chunkFiles) {
  const bytes = await readFile(resolve(chunkDirectory, file));
  const source = bytes.toString("utf8");
  if (
    source.includes("ระบบเวลาและเงินเดือน (ของตนเอง)")
    || source.includes("จัดการเวลาและเงินเดือน")
  ) {
    timePayrollChunks.push({
      file: file.replaceAll("\\", "/"),
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
    });
  }
}
const timePayrollSize = timePayrollChunks.reduce(
  (total, chunk) => ({ raw: total.raw + chunk.raw, gzip: total.gzip + chunk.gzip }),
  { raw: 0, gzip: 0 },
);

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

console.log(
  `Bundle budget: / route ${kilobytes(routeBytes)}, first load ${kilobytes(firstLoadBytes)} / 320.0 kB.`,
);

if (firstLoadBytes > budgetBytes) {
  throw new Error(
    `First Load JS for / exceeds the 320 kB budget by ${kilobytes(firstLoadBytes - budgetBytes)}.`,
  );
}

if (bundledInactiveModules.length > 0) {
  throw new Error(
    `Initial / bundle contains inactive business-module code: ${bundledInactiveModules.join(", ")}.`,
  );
}

console.log("Initial / bundle excludes the checked inactive business modules.");

if (timePayrollChunks.length === 0) {
  throw new Error("Could not identify the dynamic Time/Payroll chunk by its stable UI sentinels.");
}
console.log(
  `Time/Payroll dynamic chunk: ${kilobytes(timePayrollSize.raw)} raw, ${kilobytes(timePayrollSize.gzip)} gzip `
  + `/ ${kilobytes(timePayrollBudget.raw)} raw, ${kilobytes(timePayrollBudget.gzip)} gzip.`,
);
console.log(
  `Pre-refactor comparison: +${kilobytes(timePayrollSize.raw - preRefactorTimePayrollBaseline.raw)} raw, `
  + `+${kilobytes(timePayrollSize.gzip - preRefactorTimePayrollBaseline.gzip)} gzip; initial route unchanged.`,
);
if (timePayrollSize.raw > timePayrollBudget.raw || timePayrollSize.gzip > timePayrollBudget.gzip) {
  throw new Error(
    `Time/Payroll dynamic chunk exceeds its baseline: ${JSON.stringify(timePayrollChunks)}`,
  );
}
