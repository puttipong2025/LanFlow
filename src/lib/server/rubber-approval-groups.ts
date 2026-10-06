import {
  isNonNegativeNumeric12Scale2,
  isNonNegativePostgresInteger,
  isIsoTimestamp,
  isJsonObject,
  isSafePositiveInteger,
  isUuid,
} from "@/lib/server/management-route-error";

type GroupBody = {
  locationIds?: unknown;
  editWindowMinutes?: unknown;
  priceAllowance?: unknown;
  revisionNo?: unknown;
  sourceGroupRevisions?: unknown;
};

function isUuidArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isUuid)
    && new Set(value).size === value.length;
}

function haveSameValues(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function isCurrentOrNextRevision(actual: unknown, expected: number) {
  return actual === expected
    || (expected < Number.MAX_SAFE_INTEGER && actual === expected + 1);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isNullableDateString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isIsoTimestamp(value);
}

export function isEffectiveRubberApprovalSettings(
  value: unknown,
  expectedLocationId: string,
  expectedDateRule?: boolean,
): value is Record<string, unknown> {
  if (!isJsonObject(value)
      || value.locationId !== expectedLocationId
      || !isUuid(value.locationId)
      || !isNonNegativePostgresInteger(value.editWindowMinutes)
      || !isNonNegativeNumeric12Scale2(value.centralPrice)
      || value.centralPrice === 0
      || !isNonNegativeNumeric12Scale2(value.priceAllowance)
      || !isNonNegativeNumeric12Scale2(value.effectivePriceCap)
      || !isSafePositiveInteger(value.priceRuleRevision)
      || typeof value.nonCurrentDateRequiresApproval !== "boolean"
      || !isNullableString(value.updatedByName)
      || !isNullableString(value.updatedByPhone)
      || !isNullableDateString(value.updatedAt)) {
    return false;
  }
  const hasValidSource = (value.ruleSource === "ungrouped" && value.groupId === null)
    || (value.ruleSource === "group" && isUuid(value.groupId));
  return hasValidSource
    && (expectedDateRule === undefined
      || value.nonCurrentDateRequiresApproval === expectedDateRule)
    && Math.round(value.centralPrice * 100) + Math.round(value.priceAllowance * 100)
      === Math.round(value.effectivePriceCap * 100);
}

function isRubberApprovalGroup(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value)
    && isUuid(value.id)
    && isUuidArray(value.locationIds)
    && value.locationIds.length > 0
    && isNonNegativePostgresInteger(value.editWindowMinutes)
    && isNonNegativeNumeric12Scale2(value.priceAllowance)
    && isSafePositiveInteger(value.revisionNo)
    && isNullableString(value.updatedByName)
    && isNullableString(value.updatedByPhone)
    && isIsoTimestamp(value.updatedAt);
}

function isRubberCentralPrice(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value)
    && isNonNegativeNumeric12Scale2(value.value)
    && value.value > 0
    && isSafePositiveInteger(value.revision)
    && typeof value.updatedByName === "string"
    && isNullableString(value.updatedByPhone)
    && isIsoTimestamp(value.updatedAt);
}

function isRubberUngroupedDefaults(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value)
    && isUuidArray(value.locationIds)
    && isNonNegativePostgresInteger(value.editWindowMinutes)
    && isNonNegativeNumeric12Scale2(value.priceAllowance)
    && isSafePositiveInteger(value.revision)
    && typeof value.updatedByName === "string"
    && isNullableString(value.updatedByPhone)
    && isIsoTimestamp(value.updatedAt);
}

function isRubberMaxPriceAllowanceSetting(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value)
    && isNonNegativeNumeric12Scale2(value.value)
    && typeof value.updatedByName === "string"
    && isNullableString(value.updatedByPhone)
    && isIsoTimestamp(value.updatedAt);
}

function isRubberMaxPriceAllowanceConflict(value: unknown): value is Record<string, unknown> {
  if (!isJsonObject(value)
      || (value.scope !== "group" && value.scope !== "ungrouped")
      || !isUuidArray(value.locationIds)
      || !isNonNegativeNumeric12Scale2(value.allowance)) {
    return false;
  }
  return value.scope === "ungrouped"
    ? value.groupId === undefined
    : isUuid(value.groupId) && value.locationIds.length > 0;
}

export function isRubberMaxPriceAllowanceSaveResult(
  value: unknown,
  expectedValue?: number,
): value is Record<string, unknown> {
  if (!isJsonObject(value)) return false;
  if (value.status === "saved" || value.status === "unchanged") {
    return isRubberMaxPriceAllowanceSetting(value.setting)
      && (expectedValue === undefined || value.setting.value === expectedValue);
  }
  if (value.status === "conflict") {
    if (typeof value.errorMessage !== "string"
      || value.errorMessage.length === 0
      || !Array.isArray(value.conflicts)
      || !value.conflicts.every(isRubberMaxPriceAllowanceConflict)) {
      return false;
    }
    return value.code === "RUBBER_ALLOWANCE_STALE"
      ? value.conflicts.length === 0
      : value.code === "RUBBER_ALLOWANCE_LIMIT_TOO_LOW"
        && value.conflicts.length > 0;
  }
  return false;
}

export function isRubberApprovalGroupsResult(
  value: unknown,
  expected?: {
    centralPrice?: { value: number; revision: number };
    ungroupedDefaults?: {
      editWindowMinutes: number;
      priceAllowance: number;
      revision: number;
    };
  },
): value is Record<string, unknown> {
  if (!isJsonObject(value)
      || !Array.isArray(value.groups)
      || !value.groups.every(isRubberApprovalGroup)
      || !isUuidArray(value.availableLocationIds)
      || !isRubberCentralPrice(value.centralPrice)
      || !isRubberUngroupedDefaults(value.ungroupedDefaults)
      || !isRubberMaxPriceAllowanceSetting(value.maxPriceAllowance)) {
    return false;
  }

  const maxPriceAllowance = value.maxPriceAllowance.value as number;
  const maximumEffectivePrice = Number((
    (value.centralPrice.value as number) + maxPriceAllowance
  ).toFixed(2));
  const groupIds = value.groups.map((group) => group.id as string);
  const groupedLocationIds = value.groups.flatMap(
    (group) => group.locationIds as string[],
  );
  const partitionLocationIds = [
    ...groupedLocationIds,
    ...value.availableLocationIds,
  ];
  return haveSameValues(
    value.availableLocationIds,
    value.ungroupedDefaults.locationIds as string[],
  )
    && new Set(groupIds).size === groupIds.length
    && new Set(partitionLocationIds).size === partitionLocationIds.length
    && isNonNegativeNumeric12Scale2(maximumEffectivePrice)
    && (expected?.centralPrice === undefined
      || (value.centralPrice.value === expected.centralPrice.value
        && isCurrentOrNextRevision(
          value.centralPrice.revision,
          expected.centralPrice.revision,
        )))
    && (expected?.ungroupedDefaults === undefined
      || (value.ungroupedDefaults.editWindowMinutes === expected.ungroupedDefaults.editWindowMinutes
        && value.ungroupedDefaults.priceAllowance === expected.ungroupedDefaults.priceAllowance
        && isCurrentOrNextRevision(
          value.ungroupedDefaults.revision,
          expected.ungroupedDefaults.revision,
        )))
    && (value.ungroupedDefaults.priceAllowance as number) <= maxPriceAllowance
    && value.groups.every(
      (group) => (group.priceAllowance as number) <= maxPriceAllowance,
    );
}

export function isRubberApprovalGroupMutationResult(
  value: unknown,
  expected: {
    locationIds: string[];
    editWindowMinutes: number;
    priceAllowance: number;
    groupId?: string;
    revisionNo?: number;
  },
): value is Record<string, unknown> {
  if (!isJsonObject(value)
      || !isRubberApprovalGroup(value.group)
      || !isUuidArray(value.affectedLocationIds)) {
    return false;
  }
  return (expected.groupId === undefined || value.group.id === expected.groupId)
    && haveSameValues(value.group.locationIds as string[], expected.locationIds)
    && value.group.editWindowMinutes === expected.editWindowMinutes
    && value.group.priceAllowance === expected.priceAllowance
    && (expected.revisionNo === undefined
      ? value.group.revisionNo === 1
      : isCurrentOrNextRevision(value.group.revisionNo, expected.revisionNo));
}

export function isRubberApprovalGroupDeleteResult(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value)
    && value.success === true
    && isUuidArray(value.releasedLocationIds)
    && value.releasedLocationIds.length > 0;
}

export function parseRubberApprovalGroupBody(body: GroupBody) {
  if (!Array.isArray(body.locationIds) || body.locationIds.length === 0
      || !body.locationIds.every(isUuid)
      || new Set(body.locationIds).size !== body.locationIds.length) {
    return { errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ" } as const;
  }
  if (!isNonNegativePostgresInteger(body.editWindowMinutes)) {
    return { errorMessage: "จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" } as const;
  }
  const priceAllowance = body.priceAllowance === null ? 0 : body.priceAllowance;
  if (
    !isNonNegativeNumeric12Scale2(priceAllowance)
  ) {
    return { errorMessage: "ส่วนต่างราคาต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง" } as const;
  }
  if (body.revisionNo !== undefined && (
    !isSafePositiveInteger(body.revisionNo)
  )) {
    return { errorMessage: "revision ของกลุ่มไม่ถูกต้อง" } as const;
  }
  const sourceGroupRevisions = body.sourceGroupRevisions ?? {};
  if (!isJsonObject(sourceGroupRevisions) || Object.entries(sourceGroupRevisions).some(
    ([groupId, revision]) => !isUuid(groupId) || !isSafePositiveInteger(revision),
  )) {
    return { errorMessage: "revision ของกลุ่มต้นทางไม่ถูกต้อง" } as const;
  }
  return {
    value: {
      locationIds: body.locationIds as string[],
      editWindowMinutes: Number(body.editWindowMinutes),
      priceAllowance,
      revisionNo: body.revisionNo === undefined ? undefined : Number(body.revisionNo),
      sourceGroupRevisions: sourceGroupRevisions as Record<string, number>,
    },
  } as const;
}
