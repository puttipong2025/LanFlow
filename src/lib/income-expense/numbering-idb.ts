import { getSyncDb, RUBBER_NUMBER_STORE, SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE } from "@/lib/idb-core";
import { isRubberBillIssuer } from "@/lib/rubber-bills/numbering-contract";
import { validIncomeNumberState, incomeBaseNumber } from "@/lib/income-expense/numbering-contract";
import { buildIncomeExpensePayload } from "@/lib/income-expense/build-income-expense-payload";
import type { IncomeExpense } from "@/types";
import type { SyncEvent } from "@/lib/idb-queue";

const keyFor = (owner: string, location: string, id: string) => JSON.stringify([owner, location, id]);
type SavedSubmission = { key: string; transaction: IncomeExpense; cancelled?: boolean };
function storageFailure(error: unknown) {
  return new Error((error as { name?: string } | null)?.name === "QuotaExceededError"
    ? "พื้นที่บันทึกในเครื่องไม่พอ กรุณาเพิ่มพื้นที่ว่างแล้วลองใหม่"
    : "ยังบันทึกแถวนี้ในเครื่องไม่ได้ กรุณาลองใหม่");
}
export async function readIncomeSubmission(owner: string, location: string, id: string) {
  const db = await getSyncDb();
  return new Promise<SavedSubmission | undefined>((resolve, reject) => {
    const tx = db.transaction(INCOME_SUBMISSION_STORE, "readonly");
    const read = tx.objectStore(INCOME_SUBMISSION_STORE).get(keyFor(owner, location, id));
    tx.oncomplete = () => { db.close(); resolve(read.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function enqueueNumberedIncomeCreate(transaction: IncomeExpense, owner: string): Promise<IncomeExpense> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let saved: IncomeExpense | undefined, failure: Error | undefined;
    const tx = db.transaction([RUBBER_NUMBER_STORE, SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE], "readwrite");
    const submissions = tx.objectStore(INCOME_SUBMISSION_STORE), numbers = tx.objectStore(RUBBER_NUMBER_STORE);
    const key = keyFor(owner, transaction.locationId, transaction.clientTempId);
    const accepted = submissions.get(key);
    accepted.onsuccess = () => {
      const previous = accepted.result as SavedSubmission | undefined;
      if (previous) {
        if (previous.cancelled) { failure = new Error("รายการนี้ยกเลิกแล้ว กรุณาเพิ่มแถวใหม่"); tx.abort(); return; }
        saved = previous.transaction; return;
      }
      const read = numbers.get(transaction.locationId);
      read.onsuccess = () => {
        try {
        const state = read.result;
        if (!isRubberBillIssuer(state?.issuer) || state.issuer.locationId !== transaction.locationId
          || !validIncomeNumberState(state.incomeExpense, state.issuer.id, state.issuer.code)) {
          failure = new Error("เชื่อมต่ออินเทอร์เน็ตเพื่อเตรียมรหัสเครื่องออกบิลก่อน"); tx.abort(); return;
        }
        const scope = `${transaction.type}:${transaction.txDate}`, counter = state.incomeExpense.counters[scope] ?? 0;
        const sequence = counter + 1;
        if (!Number.isSafeInteger(sequence)) { failure = new Error("เลขลำดับเกินขอบเขตที่รองรับ"); tx.abort(); return; }
        const metadata = { version: 1 as const, issuerId: state.issuer.id, date: transaction.txDate, sequence };
        const base = incomeBaseNumber(transaction.type, transaction.txDate, sequence, state.issuer.code);
        saved = { ...transaction, localBillNo: base, number: base, billNumbering: metadata, serverSubmissionAttempted: false };
        state.incomeExpense.counters[scope] = sequence;
        state.incomeExpense.reservations[transaction.clientTempId] = { base, metadata, type: transaction.type };
        state.incomeExpense.hasIssued = true;
        state.incomeExpenseStarted = true;
        numbers.put(state);
        submissions.put({ key, transaction: saved } satisfies SavedSubmission);
        tx.objectStore(SYNC_QUEUE_STORE).add({ id: saved.clientTempId, entity: "income_expense", ownerUserId: owner,
          locationId: saved.locationId, operation: "create", payload: buildIncomeExpensePayload(saved, "create"),
          timestamp: Date.now(), status: "pending", serverSubmissionAttempted: false } satisfies SyncEvent);
        } catch (error) { failure = storageFailure(error); tx.abort(); }
      };
    };
    tx.oncomplete = () => { db.close(); if (saved) resolve(saved); else reject(new Error("ยังบันทึกรายการไม่ได้")); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? storageFailure(tx.error)); };
  });
}
