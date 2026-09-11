import {
  validRubberWeightAlertThreshold,
} from "@/lib/lanflow/rubber-weight-alert";
import { isUuid } from "@/lib/server/management-route-error";

type GroupBody = {
  locationIds?: unknown;
  thresholdKg?: unknown;
};

export function parseRubberWeightAlertGroupBody(body: GroupBody) {
  if (!Array.isArray(body.locationIds) || body.locationIds.length === 0
      || !body.locationIds.every(isUuid)
      || new Set(body.locationIds).size !== body.locationIds.length) {
    return { errorMessage: "ต้องเลือกสาขาอย่างน้อยหนึ่งสาขาและห้ามซ้ำ" } as const;
  }
  if (!validRubberWeightAlertThreshold(body.thresholdKg)) {
    return { errorMessage: "เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก." } as const;
  }
  return {
    value: {
      locationIds: body.locationIds as string[],
      thresholdKg: body.thresholdKg,
    },
  } as const;
}
