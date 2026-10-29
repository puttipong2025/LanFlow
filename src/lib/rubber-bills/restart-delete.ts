import { acknowledgeRubberCommand } from "@/lib/rubber-bills/complete-command";
import { getPendingEvents, reconcileSyncEventsIfCurrent, type SyncEvent } from "@/lib/idb-queue";
import { prepareRubberBillCommand } from "./command";
import { sendRubberBillCommand, probeDeletedRubberCommand } from "./sync-request";
import { isConfirmedRubberSyncResult } from "./sync-result";
import { recordRubberSyncFailure } from "./sync-failure";
import { isCentralRubberEvent } from "./central-sync";

// Explicit user intent only. Never called by the background coordinator.
export async function restartRubberDelete(ownerUserId: string, locationId: string, clientTempId: string) {
  if (!navigator.onLine) throw new Error("ต้องออนไลน์ก่อนขอลบใหม่");
  const events = (await getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }))
    .filter((event) => event.id === clientTempId);
  if (events.length !== 1 || events[0].operation !== "delete") {
    throw new Error("มีคำสั่งอื่นค้างอยู่ กรุณาตรวจรายการก่อนเริ่มใหม่");
  }
  const event = events[0];
  if (isCentralRubberEvent(event)) throw new Error("กรุณาตรวจผลคำสั่งในคิวซิงก์กลางก่อนเริ่มคำขอลบใหม่");
  const deleted = await probeDeletedRubberCommand(event);
  if (deleted) {
    if (!await acknowledgeRubberCommand(event, await deleted.json())) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล");
    return "silent";
  }
  if (event.failureCode !== "STALE_COMMAND_CONTEXT") {
    const response = await sendRubberBillCommand(event, { ...event.payload, submissionMode: "replay" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.errorCode === "BILL_ALREADY_DELETED" && isConfirmedRubberSyncResult(result, event)) {
      if (!await acknowledgeRubberCommand(event, result)) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล");
      return "silent";
    }
    if (response.ok && isConfirmedRubberSyncResult(result, event) && result.status !== "discarded") {
      if (!await reconcileSyncEventsIfCurrent(events, undefined, true)) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล");
      return result.status as string;
    }
    if (!(response.ok && result.status === "discarded" && isConfirmedRubberSyncResult(result, event))) {
      await recordRubberSyncFailure(event, response.status, result);
      throw new Error(result.errorMessage || "ยังยืนยันผลคำสั่งเดิมไม่ได้ กรุณาลองซิงก์อีกครั้ง");
    }
  }
  const payload = await prepareRubberBillCommand(event.payload);
  const next: SyncEvent = { ...event, payload, status: "pending", errorMessage: undefined,
    failureHttpStatus: undefined, failureCode: undefined, serverSubmissionAttempted: true, timestamp: Date.now() };
  if (!await reconcileSyncEventsIfCurrent(events, next, true)) throw new Error("คิวเปลี่ยนจากอีกหน้าต่าง กรุณาลองใหม่");
  try {
    const submitted = await sendRubberBillCommand(next, payload);
    const data = await submitted.json().catch(() => ({}));
    if (submitted.ok && isConfirmedRubberSyncResult(data, next)) {
      if (!await (next.payload.background ? acknowledgeRubberCommand(next, data) : reconcileSyncEventsIfCurrent([next], undefined, true))) throw new Error("คิวเปลี่ยนระหว่างยืนยันผล");
      return data.status as string;
    }
    await recordRubberSyncFailure(next, submitted.status, data);
    throw new Error(data.errorMessage || "กำลังรอยืนยันผลคำขอลบใหม่");
  } catch (error) {
    if (next.status === "pending") await recordRubberSyncFailure(next, 0, {});
    throw error;
  }
}
