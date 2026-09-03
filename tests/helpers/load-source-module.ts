import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

// Execute production modules while replacing only the boundaries named by a test.
export function loadSourceModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const modules = new Map<string, { exports: unknown }>();
  function load(filename: string): unknown {
    const fullPath = resolve(filename);
    if (modules.has(fullPath)) return modules.get(fullPath)!.exports;
    const module = { exports: {} };
    modules.set(fullPath, module);
    const nativeRequire = createRequire(fullPath);
    runInNewContext(ts.transpileModule(readFileSync(fullPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: (id: string) => Object.hasOwn(dependencies, id) ? dependencies[id]
        : id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`) : nativeRequire(id),
      Buffer, Request, Response, File, FormData, Headers, URL, URLSearchParams,
      AbortController, Error, TypeError, console, crypto: webcrypto,
    }, { filename: fullPath });
    return module.exports;
  }
  return load(file) as T;
}
