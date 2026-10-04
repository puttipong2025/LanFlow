import {
  isNonNegativeNumeric12Scale2,
  isNonNegativePostgresInteger,
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
