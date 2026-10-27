export type BrowserApprovalUser = {
  userId: string; required: boolean; primaryLocationId: string | null;
  pending: { id: string; label: string; requestedAt: string }[];
  lastApprovedBy: string | null; lastApprovedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

export function isBrowserApprovalUsers(value: unknown): value is BrowserApprovalUser[] {
  return Array.isArray(value) && value.every((user: unknown) => isRecord(user)
    && typeof user.userId === "string" && typeof user.required === "boolean"
    && isNullableString(user.primaryLocationId)
    && isNullableString(user.lastApprovedBy) && isNullableString(user.lastApprovedAt)
    && Array.isArray(user.pending) && user.pending.every((request: unknown) => isRecord(request)
      && typeof request.id === "string" && typeof request.label === "string"
      && typeof request.requestedAt === "string"));
}
