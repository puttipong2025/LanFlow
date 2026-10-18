import {
  validRubberWeightAlertThreshold,
} from "@/lib/lanflow/rubber-weight-alert";
import { validCashThreshold } from "@/lib/lanflow/branch-threshold-alert";
import { isUuid } from "@/lib/server/management-route-error";

type GroupBody = {
  locationIds?: unknown;
  thresholdKg?: unknown;
};

export function parseRubberWeightAlertGroupBody(body: GroupBody) {
  if (!Array.isArray(body.locationIds) || body.locationIds.length === 0
      || !body.locationIds.every(isUuid)
      || new Set(body.locationIds.map((id) => id.toLowerCase())).size !== body.locationIds.length) {
    return { errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ" } as const;
  }
  if (!validRubberWeightAlertThreshold(body.thresholdKg)) {
    return { errorMessage: "เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก." } as const;
  }
  return {
    value: {
      locationIds: (body.locationIds as string[]).map((id) => id.toLowerCase()),
      thresholdKg: body.thresholdKg,
    },
  } as const;
}

export function parseCashAlertGroupBody(body: { locationIds?: unknown; thresholdAmount?: unknown } | null) {
  if (!body || !validCashThreshold(body.thresholdAmount)) {
    return { errorMessage: "เกณฑ์เงินต้องอยู่ระหว่าง 10,000 ถึง 1,000,000 บาท และทศนิยมไม่เกินสองตำแหน่ง" } as const;
  }
  const locations = parseRubberWeightAlertGroupBody({ locationIds: body.locationIds, thresholdKg: 1 });
  if ("errorMessage" in locations) return { errorMessage: locations.errorMessage } as const;
  return { value: { locationIds: locations.value.locationIds, thresholdAmount: body.thresholdAmount } } as const;
}
