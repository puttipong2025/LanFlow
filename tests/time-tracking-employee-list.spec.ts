import { expect, test } from "@playwright/test";

import { filterTimeTrackingEmployees, resolveEmployeeFilter } from "../src/components/time-tracking/employee-list";

test.describe("Time Tracking employee list", () => {
  const users = [{ id: "a", name: "แอน" }, { id: "b", name: "บี" }];

  test("defaults to pending only when an employee has pending work", () => {
    expect(resolveEmployeeFilter(null, true)).toBe("pending");
    expect(resolveEmployeeFilter(null, false)).toBe("all");
  });

  test("filters pending employees and keeps search deterministic", () => {
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "บี", "pending")).toEqual([{ id: "b", name: "บี" }]);
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "", "all")).toHaveLength(2);
  });
});
