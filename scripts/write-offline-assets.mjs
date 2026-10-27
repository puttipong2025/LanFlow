import { readFile, writeFile } from "node:fs/promises";

// Read the generated Workbox manifest at build time, never parse executable JS in the browser.
const worker = await readFile("public/sw.js", "utf8");
const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();
const assets = [...worker.matchAll(/\{url:"([^"]+)",revision:"([^"]+)"\}/g)]
  .map(([, url, revision]) => ({ url, revision }));
if (!assets.length || !assets.some(({ url }) => url.startsWith("/_next/static/chunks/app/page-"))) {
  throw new Error("Cannot generate offline readiness manifest from this production worker");
}
await writeFile("public/offline-assets.json", JSON.stringify({ buildId, assets }));
console.log(`Offline readiness manifest: ${assets.length} assets`);
