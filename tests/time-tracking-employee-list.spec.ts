import { expect, test } from "@playwright/test";

import {
  countPendingItemsForUsers,
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

  test("counts pending transactions and slips only for users in the selected branch", () => {
    const pendingTransactions = [{ profile_id: "a" }, { profile_id: "a" }, { profile_id: "b" }];
    const pendingSlips = [{ profile_id: "a" }, { profile_id: "c" }];

    expect(countPendingItemsForUsers(pendingTransactions, pendingSlips, new Set(["a"]))).toBe(3);
    expect(countPendingItemsForUsers(pendingTransactions, pendingSlips, new Set(["a", "b", "c"]))).toBe(5);
  });
});
