import { test, expect } from "@playwright/test";
import type { ReactElement } from "react";
import type { IncomeExpense, Location, Profile } from "../src/types";
import { loadSourceModule } from "./helpers/load-source-module";

type Line = { id: string; title: string; cost: number; unit: number; price: number };
type SubmissionForm = { onSubmit: (event: { preventDefault: () => void; currentTarget: object }) => Promise<void> };
async function submit(lines: Line[], type: "income" | "expense") {
  const saved: IncomeExpense[][] = [], errors: string[] = [];
  const module = loadSourceModule<typeof import("../src/components/income-expense/IncomeExpenseModal")>("src/components/income-expense/IncomeExpenseModal.tsx", {
    react: { useState: (initial: unknown) => [Array.isArray(initial) ? lines : typeof initial === "function" ? initial() : initial, () => {}],
      useRef: (initial: unknown) => ({ current: initial }) },
    sonner: { toast: { error: (message: string) => errors.push(message) } },
    "@/hooks/useOnlineStatus": { useOnlineStatus: () => true },
    "@/hooks/useIncomeSaleItems": { useIncomeSaleItems: () => ({ items: [] }) },
  }, { FormData: class { get() { return null; } } });
  const shell = module.IncomeExpenseModal({ selectedLocation: { id: "branch", code: "T", name: "test" } as Location,
    profile: { id: "owner", name: "test", phone: "000" } as Profile, type, transaction: null,
    nextNumber: "1", nextLocalSequence: 1, onClose: () => {}, onSave: rows => { saved.push(rows); return true; } });
  const form = (shell as ReactElement<{ children: ReactElement<SubmissionForm> }>).props.children;
  await form.props.onSubmit({ preventDefault: () => {}, currentTarget: {} });
  return { saved, errors };
}
const line = (id: string, cost: number): Line => ({ id, title: id, cost, unit: 0, price: 0 });

for (const type of ["income", "expense"] as const) {
  test(`all valid ${type} lines are passed to persistence together`, async () => {
    const result = await submit([line("one", 10), line("two", 20)], type);
    expect(result.errors).toEqual([]);
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].map(row => row.title)).toEqual(["one", "two"]);
  });
  for (const cost of [0, -1]) test(`a touched ${type} line with cost ${cost} cannot silently disappear`, async () => {
    const result = await submit([line("one", 10), line("two", cost)], type);
    expect(result.saved).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
  test(`a completely unused ${type} line stays optional`, async () => {
    const result = await submit([line("one", 10), { ...line("empty", 0), title: "" }], type);
    expect(result.errors).toEqual([]);
    expect(result.saved[0].map(row => row.title)).toEqual(["one"]);
  });
  for (const cost of [Number.NaN, Number.POSITIVE_INFINITY]) test(`${type} rejects a non-finite cost ${cost}`, async () => {
    const result = await submit([line("one", 10), line("two", cost)], type);
    expect(result.saved).toEqual([]); expect(result.errors).toHaveLength(1);
  });
  test(`${type} rejects an amount with a whitespace-only title`, async () => {
    const result = await submit([line("one", 10), { ...line("two", 20), title: "  " }], type);
    expect(result.saved).toEqual([]); expect(result.errors).toHaveLength(1);
  });
}
