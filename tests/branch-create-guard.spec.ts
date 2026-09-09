import { expect, test } from "@playwright/test";
import {
  BRANCH_CONFIRMATION_DEFAULT_MINUTES,
  acknowledgeBranchCreateGuardState,
  buildBranchCreateChoices,
  clearBranchCreateGuardState,
  parseBranchCreateGuardState,
  readBranchCreateGuardState,
  reconcileBranchCreateGuardState,
  requiresBranchCreateConfirmation,
  writeBranchCreateGuardState,
} from "../src/lib/lanflow/branch-create-guard";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test.describe("branch create guard state", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  test.beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  test.afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  test("confirms both primary and secondary branches once for multi-branch accounts", () => {
    const primary = { primaryLocationId: "a", activeLocationId: "a" };
    const secondary = { primaryLocationId: "a", activeLocationId: "b" };

    const pendingPrimary = reconcileBranchCreateGuardState(null, primary);
    expect(requiresBranchCreateConfirmation(pendingPrimary, primary, ["a", "b"])).toBe(true);
    expect(requiresBranchCreateConfirmation(
      acknowledgeBranchCreateGuardState(pendingPrimary),
      primary,
      ["a", "b"],
    )).toBe(false);
    const pending = reconcileBranchCreateGuardState(null, secondary);
    expect(requiresBranchCreateConfirmation(pending, secondary, ["a", "b"])).toBe(true);
    expect(requiresBranchCreateConfirmation(
      acknowledgeBranchCreateGuardState(pending),
      secondary,
      ["a", "b"],
    )).toBe(false);
  });

  test("expires at the fixed boundary without sliding on later create attempts", () => {
    const context = { primaryLocationId: "a", activeLocationId: "b" };
    const acknowledged = acknowledgeBranchCreateGuardState(
      reconcileBranchCreateGuardState(null, context),
      1_000,
    );

    expect(requiresBranchCreateConfirmation(acknowledged, context, ["a", "b"], 15, 900_999))
      .toBe(false);
    expect(requiresBranchCreateConfirmation(acknowledged, context, ["a", "b"], 15, 901_000))
      .toBe(true);
    expect(acknowledged.acknowledgedAt).toBe(1_000);
  });

  test("rejects missing, malformed and future acknowledgement timestamps", () => {
    const context = { primaryLocationId: "a", activeLocationId: "b" };
    const pending = reconcileBranchCreateGuardState(null, context);
    expect(requiresBranchCreateConfirmation(pending, context, ["a", "b"], 15, 1_000))
      .toBe(true);
    expect(requiresBranchCreateConfirmation(
      { ...pending, acknowledgedAt: Number.NaN },
      context,
      ["a", "b"],
      15,
      1_000,
    )).toBe(true);
    expect(requiresBranchCreateConfirmation(
      { ...pending, acknowledgedAt: 1_001 },
      context,
      ["a", "b"],
      15,
      1_000,
    )).toBe(true);
  });

  test("bypasses confirmation for a single managed branch", () => {
    const context = { primaryLocationId: "a", activeLocationId: "a" };
    expect(requiresBranchCreateConfirmation(
      reconcileBranchCreateGuardState(null, context),
      context,
      ["a"],
    )).toBe(false);
  });

  test("starts a new round for A to B to A and for a changed primary branch", () => {
    const a = { primaryLocationId: "primary", activeLocationId: "a" };
    const acknowledgedA = acknowledgeBranchCreateGuardState(reconcileBranchCreateGuardState(null, a));
    const b = reconcileBranchCreateGuardState(acknowledgedA, { ...a, activeLocationId: "b" });
    const returnedA = reconcileBranchCreateGuardState(b, a);

    expect(b.acknowledgedAt).toBeNull();
    expect(returnedA.acknowledgedAt).toBeNull();
    expect(reconcileBranchCreateGuardState(acknowledgedA, { ...a, primaryLocationId: "other" }).acknowledgedAt).toBeNull();
  });

  test("keeps acknowledgement for a reload of the same user and branch", () => {
    const context = { primaryLocationId: "a", activeLocationId: "b" };
    const acknowledged = acknowledgeBranchCreateGuardState(reconcileBranchCreateGuardState(null, context));
    expect(writeBranchCreateGuardState("user-a", acknowledged)).toBe(true);

    expect(reconcileBranchCreateGuardState(readBranchCreateGuardState("user-a"), context)).toEqual(acknowledged);
    expect(readBranchCreateGuardState("user-b")).toBeNull();
  });

  test("still confirms when no primary branch exists", () => {
    const context = { primaryLocationId: null, activeLocationId: "a" };
    expect(requiresBranchCreateConfirmation(
      reconcileBranchCreateGuardState(null, context),
      context,
      ["a", "b"],
    )).toBe(true);
  });

  test("builds two choices for two branches and caps larger accounts at three", () => {
    const locations = [
      { id: "a", name: "สาขา A" },
      { id: "b", name: "สาขา B" },
      { id: "c", name: "สาขา C" },
      { id: "d", name: "สาขา D" },
    ];
    expect(buildBranchCreateChoices(locations.slice(0, 2), "a", () => 0))
      .toHaveLength(2);

    const choices = buildBranchCreateChoices(locations, "d", () => 0);
    expect(choices).toHaveLength(3);
    expect(choices).toContainEqual({ id: "d", name: "สาขา D" });
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(3);
  });

  test("fails closed when the active branch is not managed", () => {
    const context = { primaryLocationId: "a", activeLocationId: "b" };
    expect(requiresBranchCreateConfirmation(
      reconcileBranchCreateGuardState(null, context),
      context,
      [],
    )).toBe(true);
    expect(requiresBranchCreateConfirmation(
      reconcileBranchCreateGuardState(null, context),
      context,
      ["a"],
    )).toBe(true);
    expect(buildBranchCreateChoices([{ id: "a", name: "สาขา A" }], "b", () => 0))
      .toEqual([]);
  });

  test("rejects malformed or incompatible persisted state and can clear valid state", () => {
    expect(parseBranchCreateGuardState("not-json")).toBeNull();
    expect(parseBranchCreateGuardState(JSON.stringify({
      version: 1,
      primaryLocationId: "a",
      activeLocationId: "b",
      acknowledged: true,
    }))).toBeNull();
    expect(parseBranchCreateGuardState(JSON.stringify({
      version: 2,
      primaryLocationId: "",
      activeLocationId: "b",
      acknowledged: true,
    }))).toBeNull();
    expect(parseBranchCreateGuardState(JSON.stringify({
      version: 3,
      primaryLocationId: "a",
      activeLocationId: "b",
      acknowledgedAt: 1_000,
      unexpected: "ignored",
    }))).toEqual({
      version: 3,
      primaryLocationId: "a",
      activeLocationId: "b",
      acknowledgedAt: 1_000,
    });

    const context = { primaryLocationId: "a", activeLocationId: "b" };
    localStorage.setItem("lanflow:branch-create-guard:v1:user-a", JSON.stringify({
      version: 1,
      primaryLocationId: "a",
      activeLocationId: "b",
      acknowledged: true,
    }));
    expect(readBranchCreateGuardState("user-a")).toBeNull();
    expect(localStorage.getItem("lanflow:branch-create-guard:v1:user-a")).toBeNull();

    localStorage.setItem("lanflow:branch-create-guard:v2:user-a", JSON.stringify({
      version: 2,
      primaryLocationId: "a",
      activeLocationId: "b",
      acknowledged: true,
    }));
    expect(readBranchCreateGuardState("user-a")).toBeNull();
    expect(localStorage.getItem("lanflow:branch-create-guard:v2:user-a")).toBeNull();

    writeBranchCreateGuardState("user-a", reconcileBranchCreateGuardState(null, context));
    clearBranchCreateGuardState("user-a");
    expect(readBranchCreateGuardState("user-a")).toBeNull();
  });

  test("uses the documented default duration", () => {
    expect(BRANCH_CONFIRMATION_DEFAULT_MINUTES).toBe(15);
  });
});
