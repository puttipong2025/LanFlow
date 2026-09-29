import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

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
