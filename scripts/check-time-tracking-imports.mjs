import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

const repoRoot = resolve(".");
const domainRoot = resolve("src/components/time-tracking");
const entrypoint = resolve("src/components/TimeTrackingModule.tsx");
const moduleFiles = (await readdir(domainRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)))
  .map((entry) => resolve(entry.parentPath, entry.name));
const files = [entrypoint, ...moduleFiles];
const fileSet = new Set(files);
const graph = new Map();
const violations = [];

const normalize = (path) => path.replaceAll("\\", "/");
const resolveImport = (owner, specifier) => {
  const base = specifier.startsWith(".")
    ? resolve(dirname(owner), specifier)
    : specifier.startsWith("@/components/time-tracking/")
      ? resolve(repoRoot, "src/components/time-tracking", specifier.slice("@/components/time-tracking/".length))
      : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]
    .find((candidate) => fileSet.has(candidate)) ?? null;
};

for (const file of files) {
  const source = await readFile(file, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((match) => resolveImport(file, match[1]))
    .filter(Boolean);
  graph.set(file, imports);

  const owner = normalize(relative(domainRoot, file));
  for (const imported of imports) {
    const dependency = normalize(relative(domainRoot, imported));
    if (file !== entrypoint && !owner.startsWith("manager/") && dependency.startsWith("manager/")) {
      violations.push(`${owner} must not import manager owner ${dependency}`);
    }
    if (
      ["payroll/", "audit/", "attendance/", "settings/", "periods/"].some((prefix) => owner.startsWith(prefix))
      && (dependency.startsWith("manager/") || dependency.startsWith("employee/"))
    ) {
      violations.push(`${owner} must remain a leaf and not import ${dependency}`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
const visit = (file, trail) => {
  if (visiting.has(file)) {
    violations.push(`circular import: ${[...trail, file].map((item) => normalize(relative(repoRoot, item))).join(" -> ")}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
};
for (const file of files) visit(file, []);

if (violations.length > 0) {
  throw new Error(`Time/Payroll import-direction check failed:\n- ${violations.join("\n- ")}`);
}
console.log(`Time/Payroll import-direction check passed across ${files.length} modules with no cycles.`);

