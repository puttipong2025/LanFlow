import { expect, test } from "@playwright/test";

import {
  countWorkItemsForUsers,
  filterTimeTrackingEmployees,
  resolveEmployeeFilter,
} from "../src/components/time-tracking/employee-list";

test.describe("Time Tracking employee list", () => {
  const users = [
    { id: "a", name: "แอน", primary_location_id: "north" },
    { id: "b", name: "บี", primary_location_id: "south" },
    { id: "c", name: "ซี", primary_location_id: null },
  ];

  test("defaults to pending only when an employee has pending work", () => {
    expect(resolveEmployeeFilter(null, true)).toBe("pending");
    expect(resolveEmployeeFilter(null, false)).toBe("all");
  });

  test("filters pending employees and keeps search deterministic", () => {
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "บี", "pending", "south")).toEqual([users[1]]);
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "", "all", "north")).toEqual([users[0]]);
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "", "all", "all")).toHaveLength(3);
    expect(filterTimeTrackingEmployees(users, new Set(["b"]), "", "all", "unassigned")).toEqual([users[2]]);
  });

  test("counts pending items and missing-slip months only for users in the selected branch", () => {
    const pendingTransactions = [{ profile_id: "a" }, { profile_id: "a" }, { profile_id: "b" }];
    const pendingSlips = [{ profile_id: "a" }, { profile_id: "c" }];
    const workUsers = [
      { id: "a", missing_payroll_months: ["2026-07", "2026-08"] },
      { id: "b", missing_payroll_months: ["2026-08"] },
      { id: "c", missing_payroll_months: [] },
    ];

    expect(countWorkItemsForUsers(pendingTransactions, pendingSlips, workUsers, new Set(["a"]))).toBe(5);
    expect(countWorkItemsForUsers(pendingTransactions, pendingSlips, workUsers, new Set(["a", "b", "c"]))).toBe(8);
  });
});
