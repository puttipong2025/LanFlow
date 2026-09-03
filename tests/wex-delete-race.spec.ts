import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effects: Array<() => void> = [];
  const reads: Array<{ response: ReturnType<typeof deferred<Response>>; signal?: AbortSignal | null }> = [];
  const deletion = deferred<Response>();
  const module = loadSourceModule<typeof import("../src/hooks/useExportVehicleWeighBills")>(
    "src/hooks/useExportVehicleWeighBills.ts", {
      react: {
        useState: (initial: unknown) => {
          const index = stateIndex++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
        useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => void) => { effects.push(effect); },
      },
      "@/lib/auth-fetch": {
        assertApiResponse: async (response: Response) => { if (!response.ok) throw new Error("request failed"); },
        authFetch: async (_url: string, init?: RequestInit) => {
          if (init?.method === "DELETE") return deletion.promise;
          const response = deferred<Response>();
          reads.push({ response, signal: init?.signal });
          return response.promise;
        },
      },
    },
  );
  function render(locationId = "branch-a") {
    stateIndex = 0; refIndex = 0; effects = [];
    return module.useExportVehicleWeighBills({ locationId, online: true });
  }
  const reply = (index: number, ids: string[]) => reads[index].response.resolve(Response.json({
    bills: ids.map((id) => ({ id })), hasMore: false, nextCursor: null,
  }));
  const settled = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };
  return { render, reads, deletion, reply, settled, changeScope: () => effects[0]() };
}

test("confirmed WEX delete invalidates stale list responses and refreshes pagination", async () => {
  const f = fixture();
  const initial = f.render().reload();
  f.reply(0, ["deleted", "retained"]); await initial;
  const oldRead = f.render().reload();
  const removal = f.render().remove("deleted", 1);
  f.deletion.resolve(Response.json({ status: "deleted" }));
  await f.settled();
  f.reply(1, ["deleted", "retained"]); await oldRead;
  expect(f.render().bills.map((bill) => bill.id)).toEqual(["retained"]);
  expect(f.reads[1].signal?.aborted).toBe(true);
  expect(f.render().loading).toBe(true); // Old finally cannot clear the new request's spinner.
  expect(f.reads).toHaveLength(3);
  f.reply(2, ["retained"]); await removal;
  expect(f.render().loading).toBe(false);
  expect(f.render().hasMore).toBe(false);
});

test("failed WEX deletion retains the row and does not replace the current list request", async () => {
  const f = fixture();
  const initial = f.render().reload(); f.reply(0, ["retained"]); await initial;
  const removal = f.render().remove("retained", 1);
  f.deletion.resolve(Response.json({ error: "conflict" }, { status: 409 }));
  const failure = await removal.then(() => null, (error: unknown) => error);
  expect(failure).toMatchObject({ message: "request failed" });
  expect(f.render().bills.map((bill) => bill.id)).toEqual(["retained"]);
  expect(f.reads).toHaveLength(1);
});

test("old-scope delete does not cancel a new branch's loading request", async () => {
  const f = fixture();
  const initial = f.render().reload(); f.reply(0, ["branch-a-bill"]); await initial;
  const removal = f.render().remove("branch-a-bill", 1);
  f.render("branch-b"); f.changeScope();
  f.deletion.resolve(Response.json({ status: "deleted" })); await removal;
  expect(f.reads[1].signal?.aborted).toBe(false);
  expect(f.reads).toHaveLength(2);
  f.reply(1, ["branch-b-bill"]); await f.settled();
  expect(f.render("branch-b").bills.map((bill) => bill.id)).toEqual(["branch-b-bill"]);
});
