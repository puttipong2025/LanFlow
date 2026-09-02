import { expect, test } from "@playwright/test";
import { buildPayrollPeriodState } from "../src/lib/time-tracking/period-state";

test("period state makes END inactive on its selected date", () => {
  const state = buildPayrollPeriodState([{
    id: "period-1",
    start_on: "2026-08-01",
    end_on: "2026-09-01",
  }], "2026-09-01");

  expect(state.currentStatus).toBe("INACTIVE");
  expect(state.currentPeriod).toBeNull();
  expect(state.nextAction).toBeNull();
  expect(state.hasPeriodHistory).toBe(true);
  expect(state.resumeEarliestOn).toBe("2026-09-01");
  expect(state.resumeCorrection).toBeNull();
});

test("period state keeps a future END active until the selected first unpaid day", () => {
  const state = buildPayrollPeriodState([{
    id: "period-future-end",
    start_on: "2026-08-01",
    end_on: "2026-09-04",
    scheduled_action: "END",
    scheduled_effective_on: "2026-09-05",
    scheduled_activation_on: "2026-09-05",
  }], "2026-09-01");

  expect(state.currentStatus).toBe("ACTIVE");
  expect(state.currentPeriod?.endOn).toBe("2026-09-04");
  expect(state.nextAction).toEqual({
    action: "END",
    selectedEffectiveOn: "2026-09-05",
    activationOn: "2026-09-05",
  });
  expect(state.resumeCorrection).toBeNull();
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
  expect(state.resumeEarliestOn).toBeNull();
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

test("period state exposes a correction window only for a separate resumed period", () => {
  const state = buildPayrollPeriodState([{
    id: "period-1",
    start_on: "2026-08-01",
    end_on: "2026-08-15",
  }, {
    id: "period-2",
    start_on: "2026-09-01",
    end_on: null,
  }], "2026-09-02");

  expect(state.resumeCorrection).toEqual({
    currentStartOn: "2026-09-01",
    earliestOn: "2026-08-16",
  });
  expect(state.resumeEarliestOn).toBeNull();
});

test("period state hides a correction control when today is the only valid date", () => {
  const state = buildPayrollPeriodState([{
    id: "period-1",
    start_on: "2026-09-01",
    end_on: "2026-09-01",
  }, {
    id: "period-2",
    start_on: "2026-09-02",
    end_on: null,
  }], "2026-09-02");

  expect(state.resumeCorrection).toBeNull();
});

test("period state derives the earliest RESUME date from the latest closed period", () => {
  const state = buildPayrollPeriodState([{
    id: "period-1",
    start_on: "2026-07-01",
    end_on: "2026-08-15",
  }], "2026-09-02");

  expect(state.resumeEarliestOn).toBe("2026-08-16");
  expect(state.resumeCorrection).toBeNull();
});
