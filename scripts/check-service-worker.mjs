import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicDirectory = resolve("public");
const serviceWorkerPath = resolve(publicDirectory, "sw.js");
const middlewareManifestPath = resolve(".next", "server", "middleware-manifest.json");
const [source, publicEntries, middlewareManifestSource] = await Promise.all([
  readFile(serviceWorkerPath, "utf8"),
  readdir(publicDirectory),
  readFile(middlewareManifestPath, "utf8"),
]);
const helpers = ["_async_to_generator", "_ts_generator"];

const unresolved = helpers.filter((helper) => {
  if (!source.includes(helper)) return false;
  const escaped = helper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`function\\s+${escaped}|(?:var|let|const)\\s+${escaped}`).test(source);
});

const precachesAuthenticatedStartUrl =
  /\{\s*url\s*:\s*["']\/["']\s*,\s*revision\s*:/.test(source);

if (unresolved.length > 0) {
  throw new Error(`Generated service worker references undefined helpers: ${unresolved.join(", ")}`);
}

if (precachesAuthenticatedStartUrl) {
  throw new Error("Generated service worker must not precache the authenticated start URL '/'");
}

const middlewareManifest = JSON.parse(middlewareManifestSource);
const matcherSource = middlewareManifest.middleware?.["/"]?.matchers?.[0]?.regexp;

if (typeof matcherSource !== "string") {
  throw new Error("Compiled middleware matcher is missing from the production build");
}

const middlewareMatcher = new RegExp(matcherSource);
const generatedWorkerNames = publicEntries.filter((name) =>
  /^(?:fallback|swe-worker|worker|workbox)-.+\.js$/.test(name)
);
const referencedWorkerNames = new Set(
  [...source.matchAll(/(?:\.\/|\/)((?:fallback|swe-worker|worker|workbox)-[A-Za-z0-9_-]+)(?:\.js)?["']/g)]
    .map((match) => `${match[1]}.js`)
);
const missingReferencedWorkers = [...referencedWorkerNames].filter(
  (name) => !publicEntries.includes(name)
);

if (missingReferencedWorkers.length > 0) {
  throw new Error(`PWA workers referenced by sw.js are missing: ${missingReferencedWorkers.join(", ")}`);
}

const interceptedWorkers = generatedWorkerNames.filter((name) =>
  middlewareMatcher.test(`/${name}`)
);

if (interceptedWorkers.length > 0) {
  throw new Error(
    `Generated PWA workers would be intercepted by authentication middleware: ${interceptedWorkers.join(", ")}`
  );
}

const unreferencedWorkers = generatedWorkerNames.filter((name) => {
  const stem = name.slice(0, -".js".length);
  return !source.includes(name) && !source.includes(stem);
});

if (unreferencedWorkers.length > 0) {
  throw new Error(`Generated PWA workers are not referenced by sw.js: ${unreferencedWorkers.join(", ")}`);
}

const unprotectedWorkerNearMisses = [
  "/swe-worker-private.js",
  "/swe-worker-0123456789abcde.js",
  "/workbox-private.js",
  "/workbox-0123456.js",
].filter((pathname) => !middlewareMatcher.test(pathname));

if (unprotectedWorkerNearMisses.length > 0) {
  throw new Error(
    `Non-generated worker-like routes bypass authentication middleware: ${unprotectedWorkerNearMisses.join(", ")}`
  );
}

console.log("Service worker checks passed.");
