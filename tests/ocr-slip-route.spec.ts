import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import * as nextServer from "next/server";
import ts from "typescript";
import * as parser from "../src/lib/server/ocr-slip";

test("slip handler bounds uploads and maps upstream failures without exposing their bodies", async () => {
  const source = readFileSync(path.resolve(__dirname, "../src/app/api/lanflow/ocr-slip/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as { POST: (request: nextServer.NextRequest) => Promise<Response> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "next/server") return nextServer;
    if (name === "@/lib/server/ocr-slip") return parser;
    if (name === "@/lib/server/auth") return { requireAuth: async () => ({ ok: true }) };
    throw new Error(`Unexpected route import: ${name}`);
  }, module, module.exports);

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let upstreamCalls = 0;
  let upstream: () => Promise<Response> = async () => Response.json({});
  globalThis.fetch = async (_input, init) => {
    upstreamCalls += 1;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return upstream();
  };
  const invoke = (bytes = 1, type = "image/jpeg") => {
    const form = new FormData();
    form.set("image", new File([new Uint8Array(bytes)], "synthetic.jpg", { type }));
    return module.exports.POST(new nextServer.NextRequest("http://localhost/api/lanflow/ocr-slip", { method: "POST", body: form }));
  };
  try {
    process.env.OPENROUTER_API_KEY = "synthetic-test-key";
    for (const [size, type] of [[0, "image/jpeg"], [parser.OCR_SLIP_MAX_IMAGE_BYTES + 1, "image/jpeg"], [1, "application/pdf"]] as const) {
      expect((await invoke(size, type)).status).toBe(400);
    }
    expect(upstreamCalls).toBe(0);
    delete process.env.OPENROUTER_API_KEY;
    expect((await invoke()).status).toBe(503);
    expect(upstreamCalls).toBe(0);
    process.env.OPENROUTER_API_KEY = "synthetic-test-key";
    for (const status of [429, 500]) {
      upstream = async () => new Response("PRIVATE_UPSTREAM_DETAIL", { status });
      const response = await invoke();
      expect(response.status).toBe(status === 429 ? 429 : 503);
      expect(await response.text()).not.toContain("PRIVATE_UPSTREAM_DETAIL");
    }
    upstream = async () => { throw new DOMException("synthetic timeout", "TimeoutError"); };
    expect((await invoke()).status).toBe(503);
    upstream = async () => Response.json({ choices: [{ message: { content: '{"amount":true}' } }] });
    expect((await invoke()).status).toBe(422);
    upstream = async () => Response.json({ choices: [{ message: { content: '{"amount":100,"fee":0}' } }] });
    expect(await (await invoke()).json()).toMatchObject({ amount: 100, fee: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
