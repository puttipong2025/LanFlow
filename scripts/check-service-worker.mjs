import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const serviceWorkerPath = resolve("public", "sw.js");
const source = await readFile(serviceWorkerPath, "utf8");
const helpers = ["_async_to_generator", "_ts_generator"];

const unresolved = helpers.filter((helper) => {
  if (!source.includes(helper)) return false;
  const escaped = helper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`function\\s+${escaped}|(?:var|let|const)\\s+${escaped}`).test(source);
});

if (unresolved.length > 0) {
  throw new Error(`Generated service worker references undefined helpers: ${unresolved.join(", ")}`);
}

console.log("Service worker helper check passed.");
