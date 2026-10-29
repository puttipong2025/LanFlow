import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
export { sendRubberBillCommand } from "@/lib/rubber-bills/sync-request";
export { isConfirmedRubberSyncResult } from "@/lib/rubber-bills/sync-result";
export { recordRubberSyncFailure } from "@/lib/rubber-bills/sync-failure";
export { acknowledgeRubberCommand } from "@/lib/rubber-bills/complete-command";

export async function prepareRubberBillCommand(payload: Record<string, any>, actorUserId?: string, options: { deferContext?: boolean; commandId?: string; completingLocal?: boolean } = {}) {
  payload = { ...payload }; delete payload.localContextPending;
  let generation = 0;
  let queueVersion = 0;
  if (!options.deferContext && (typeof navigator === "undefined" || navigator.onLine)) {
    const params = new URLSearchParams({ locationId: payload.locationId, clientTempId: payload.clientTempId });
    const response = await authFetch(`/api/lanflow/rubber-bills/command-context?${params}`, { signal: AbortSignal.timeout(10_000) }, { background: options.completingLocal === true });
    await assertApiResponse(response);
    const context = await response.json();
    if (!Number.isSafeInteger(context.generation) || context.generation < 0
        || !Number.isSafeInteger(context.revisionNo) || context.revisionNo < 0) {
      throw new Error("ตรวจสถานะคำสั่งบิลยางไม่สำเร็จ กรุณาลองใหม่");
    }
    if (!options.completingLocal && context.recordStatus === "deleted") throw new Error("บิลนี้ถูกลบแล้ว");
    if (!options.completingLocal && payload.operation === "create" && context.revisionNo > 0) throw new Error("บิลนี้ถูกบันทึกแล้ว กรุณาเปิดบิลปัจจุบัน");
    if (payload.operation === "create" && payload.inputMethod === "ocr" && !payload.ocrUploadId) {
      if (!context.ocrUploadId) throw new Error("ไม่พบรูป OCR ที่คุณมีสิทธิ์ใช้ กรุณาเลือกรูปใหม่");
      payload = { ...payload, ocrUploadId: context.ocrUploadId };
    }
    if (!options.completingLocal && payload.operation === "update" && context.revisionNo !== payload.expectedRevisionNo) {
      throw new Error("บิลถูกแก้ไขแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนส่งใหม่");
    }
    if (payload.operation === "delete") payload = { ...payload, expectedRevisionNo: context.revisionNo };
    generation = context.generation;
    if (context.queueVersion !== undefined && (!Number.isSafeInteger(context.queueVersion) || context.queueVersion < 0)) {
      throw new Error("ตรวจสถานะคิวกลางไม่สำเร็จ กรุณาลองใหม่");
    }
    queueVersion = context.queueVersion ?? 0;
  } else if (!options.deferContext && (payload.operation !== "create" || options.completingLocal)) {
    throw new Error(options.completingLocal
      ? "ต้องออนไลน์เพื่อเตรียมคำสั่งบิลยางก่อนส่ง"
      : "รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ");
  }
  const commandId = options.commandId ?? crypto.randomUUID();
  return { ...payload, contractVersion: 2, commandId, idempotencyKey: commandId, expectedCommandGeneration: generation,
    ...(actorUserId ? { centralQueue: true, background: true, actorUserId, expectedQueueVersion: queueVersion } : {}),
    ...(options.deferContext ? { localContextPending: true } : {}) };
}
