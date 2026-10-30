import type { SyncEvent } from "@/lib/idb-queue";

export const LOCAL_OCR_SOURCE_MISSING = "LOCAL_OCR_SOURCE_MISSING";

export class RubberPreparationError extends Error {
  readonly code = LOCAL_OCR_SOURCE_MISSING;
}

// Only staged commands that provably never reached admission have a local exit.
export function isUnsubmittedRubberPreparationFailure(event: SyncEvent & { centralAccepted?: boolean }) {
  return event.entity === "rubber_bills" && event.operation === "create"
    && event.payload.contractVersion === 2 && event.payload.centralQueue === true && event.payload.localContextPending === true
    && event.status === "failed" && event.failureCode === LOCAL_OCR_SOURCE_MISSING
    && event.serverSubmissionAttempted === false && event.centralAccepted !== true;
}
