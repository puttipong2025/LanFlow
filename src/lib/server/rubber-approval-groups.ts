import { isUuid } from "@/lib/server/management-route-error";

type GroupBody = {
  locationIds?: unknown;
  editWindowMinutes?: unknown;
  configuredPrice?: unknown;
};

export function parseRubberApprovalGroupBody(body: GroupBody) {
  if (!Array.isArray(body.locationIds) || body.locationIds.length === 0
      || !body.locationIds.every(isUuid)
      || new Set(body.locationIds).size !== body.locationIds.length) {
    return { errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ" } as const;
  }
  if (!Number.isInteger(body.editWindowMinutes) || Number(body.editWindowMinutes) < 0) {
    return { errorMessage: "จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" } as const;
  }
  const configuredPrice = body.configuredPrice === null ? null : body.configuredPrice;
  if (configuredPrice !== null && (
    typeof configuredPrice !== "number"
    || !Number.isFinite(configuredPrice)
    || configuredPrice < 0
    || Number(configuredPrice.toFixed(2)) !== configuredPrice
  )) {
    return { errorMessage: "ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง" } as const;
  }
  return {
    value: {
      locationIds: body.locationIds as string[],
      editWindowMinutes: Number(body.editWindowMinutes),
      configuredPrice,
    },
  } as const;
}
