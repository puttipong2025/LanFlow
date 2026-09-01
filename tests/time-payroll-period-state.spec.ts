import { expect, test } from "@playwright/test";
import { buildPayrollPeriodState } from "../src/lib/time-tracking/period-state";

test("period state keeps END active through its selected last paid day", () => {
  const state = buildPayrollPeriodState([{
    id: "period-1",
    start_on: "2026-08-01",
    end_on: "2026-09-01",
    scheduled_action: "END",
    scheduled_effective_on: "2026-09-01",
    scheduled_activation_on: "2026-09-02",
  }], "2026-09-01");

  expect(state.currentStatus).toBe("ACTIVE");
  expect(state.currentPeriod?.endOn).toBe("2026-09-01");
  expect(state.nextAction).toEqual({
    action: "END",
    selectedEffectiveOn: "2026-09-01",
    activationOn: "2026-09-02",
  });
});

test("period state exposes a future enable without treating it as active", () => {
  const state = buildPayrollPeriodState([{
    id: "period-2",
    start_on: "2026-09-05",
    end_on: null,
    scheduled_action: "ENABLE",
    scheduled_effective_on: "2026-09-05",
    scheduled_activation_on: "2026-09-05",
  }], "2026-09-01");

  expect(state.currentStatus).toBe("INACTIVE");
  expect(state.currentPeriod).toBeNull();
  expect(state.nextAction?.action).toBe("ENABLE");
  expect(state.hasPeriodHistory).toBe(false);
});

test("period state ignores metadata after its activation date", () => {
  const state = buildPayrollPeriodState([{
    id: "period-3",
    start_on: "2026-09-01",
    end_on: null,
    scheduled_action: "RESUME",
    scheduled_effective_on: "2026-09-01",
    scheduled_activation_on: "2026-09-01",
  }], "2026-09-01");

  expect(state.currentStatus).toBe("ACTIVE");
  expect(state.nextAction).toBeNull();
});
