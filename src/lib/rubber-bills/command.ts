import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
export { sendRubberBillCommand } from "@/lib/rubber-bills/sync-request";
export { isConfirmedRubberSyncResult } from "@/lib/rubber-bills/sync-result";
export { recordRubberSyncFailure } from "@/lib/rubber-bills/sync-failure";
export { acknowledgeRubberCommand } from "@/lib/rubber-bills/complete-command";

export async function prepareRubberBillCommand(payload: Record<string, any>) {
  let generation = 0;
  if (typeof navigator === "undefined" || navigator.onLine) {
    const params = new URLSearchParams({ locationId: payload.locationId, clientTempId: payload.clientTempId });
    const response = await authFetch(`/api/lanflow/rubber-bills/command-context?${params}`);
    await assertApiResponse(response);
    const context = await response.json();
    if (!Number.isSafeInteger(context.generation) || context.generation < 0
        || !Number.isSafeInteger(context.revisionNo) || context.revisionNo < 0) {
      throw new Error("ตรวจสถานะคำสั่งบิลยางไม่สำเร็จ กรุณาลองใหม่");
    }
    if (context.recordStatus === "deleted") throw new Error("บิลนี้ถูกลบแล้ว");
    if (payload.operation === "create" && context.revisionNo > 0) throw new Error("บิลนี้ถูกบันทึกแล้ว กรุณาเปิดบิลปัจจุบัน");
    if (payload.operation === "create" && payload.inputMethod === "ocr" && !payload.ocrUploadId) {
      if (!context.ocrUploadId) throw new Error("ไม่พบรูป OCR ที่คุณมีสิทธิ์ใช้ กรุณาเลือกรูปใหม่");
      payload = { ...payload, ocrUploadId: context.ocrUploadId };
    }
    if (payload.operation === "update" && context.revisionNo !== payload.expectedRevisionNo) {
      throw new Error("บิลถูกแก้ไขแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนส่งใหม่");
    }
    if (payload.operation === "delete") payload = { ...payload, expectedRevisionNo: context.revisionNo };
    generation = context.generation;
  } else if (payload.operation !== "create") {
    throw new Error("รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ");
  }
  const commandId = crypto.randomUUID();
  return { ...payload, contractVersion: 2, commandId, idempotencyKey: commandId, expectedCommandGeneration: generation };
}
