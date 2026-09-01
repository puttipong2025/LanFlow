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

export function countPendingItemsForUsers(
  pendingTransactions: Array<{ profile_id: string }> | undefined,
  pendingSlips: Array<{ profile_id: string }> | undefined,
  userIds: Set<string>,
) {
  return [...(pendingTransactions || []), ...(pendingSlips || [])]
    .filter((item) => userIds.has(item.profile_id)).length;
}
