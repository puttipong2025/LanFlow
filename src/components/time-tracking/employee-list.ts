export function resolveEmployeeFilter(
  selected: "pending" | "all" | null,
  hasPendingEmployees: boolean,
) {
  return selected ?? (hasPendingEmployees ? "pending" : "all");
}

export function filterTimeTrackingEmployees<T extends { id: string; name: string }>(
  users: T[],
  pendingUserIds: Set<string>,
  search: string,
  filter: "pending" | "all",
  branch: string = "all",
) {
  const normalizedSearch = search.trim().toLocaleLowerCase("th");
  return users.filter((user) => (
    user.name.toLocaleLowerCase("th").includes(normalizedSearch)
    && (filter === "all" || pendingUserIds.has(user.id))
    && (
      branch === "all"
      || (branch === "unassigned" && !("primary_location_id" in user && user.primary_location_id))
      || ("primary_location_id" in user && user.primary_location_id === branch)
    )
  ));
}

export function missingPayrollMonthCount(user: { missing_payroll_months?: unknown }) {
  return Array.isArray(user.missing_payroll_months) ? user.missing_payroll_months.length : 0;
}

export function hasEmployeeWork(
  user: { id: string; missing_payroll_months?: unknown },
  pendingTransactions: Array<{ profile_id: string }> | undefined,
  pendingSlips: Array<{ profile_id: string }> | undefined,
) {
  return missingPayrollMonthCount(user) + [...(pendingTransactions || []), ...(pendingSlips || [])]
    .filter((item) => item.profile_id === user.id).length > 0;
}

export function countWorkItemsForUsers(
  pendingTransactions: Array<{ profile_id: string }> | undefined,
  pendingSlips: Array<{ profile_id: string }> | undefined,
  users: Array<{ id: string; missing_payroll_months?: unknown }>,
  userIds: Set<string>,
) {
  const pendingCount = [...(pendingTransactions || []), ...(pendingSlips || [])]
    .filter((item) => userIds.has(item.profile_id)).length;
  return pendingCount + users
    .filter((user) => userIds.has(user.id))
    .reduce((sum, user) => sum + missingPayrollMonthCount(user), 0);
}
