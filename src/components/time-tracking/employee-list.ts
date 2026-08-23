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
) {
  const normalizedSearch = search.trim().toLocaleLowerCase("th");
  return users.filter((user) => (
    user.name.toLocaleLowerCase("th").includes(normalizedSearch)
    && (filter === "all" || pendingUserIds.has(user.id))
  ));
}
