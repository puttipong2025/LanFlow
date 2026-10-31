import { getSyncDb, RUBBER_NUMBER_STORE, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import type { SyncEvent } from "@/lib/idb-queue";
import type { RubberBill } from "@/types";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { isRubberBillIssuer, isRubberBillNumbering, rubberBaseNumber, type RubberBillIssuer, type RubberBillNumbering } from "./numbering-contract";

type Reservation = { base: string; metadata: RubberBillNumbering };
type NumberState = { key: string; version: 1; installationId: string; generationId: string;
  issuer?: RubberBillIssuer; counters: Record<string, number>; reservations: Record<string, Reservation>; checkedAt: number };
const flights = new Map<string, Promise<void>>();
const message = "เชื่อมต่ออินเทอร์เน็ตเพื่อเตรียมรหัสเครื่องออกบิลก่อน";
function validState(x: NumberState | undefined): x is NumberState {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return Boolean(x && x.version === 1 && uuid.test(x.installationId) && uuid.test(x.generationId)
    && Number.isFinite(x.checkedAt) && x.checkedAt >= 0
    && x.counters && typeof x.counters === "object" && !Array.isArray(x.counters)
    && x.reservations && typeof x.reservations === "object" && !Array.isArray(x.reservations)
    && ((isRubberBillIssuer(x.issuer) && x.issuer.locationId === x.key) || (x.issuer === undefined && x.checkedAt === 0
      && Object.keys(x.counters).length === 0 && Object.keys(x.reservations).length === 0))
    && Object.values(x.counters).every(v => Number.isSafeInteger(v) && v >= 0)
    && Object.values(x.reservations).every(v => {
      if (!v || typeof v.base !== "string" || !isRubberBillNumbering(v.metadata)) return false;
      const { date, sequence, issuerId } = v.metadata, parsed = new Date(`${date}T00:00:00Z`);
      const code = v.base.split("-").at(-1) ?? "", currentIssuer = issuerId.toLowerCase() === x.issuer?.id.toLowerCase();
      return !date.startsWith("0000") && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
        && /^D\d{2,18}$/.test(code) && (!currentIssuer || code === x.issuer?.code)
        && (v.base === rubberBaseNumber(date, sequence, code)
          || v.base === `${date.slice(2).replaceAll("-", "")}${String(sequence).padStart(4, "0")}-${code}`)
        && (!currentIssuer || (x.counters[date] ?? -1) >= sequence);
    }));
}
async function state(locationId: string, initialize = false): Promise<NumberState | null> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let result: NumberState | null = null;
    const tx = db.transaction(RUBBER_NUMBER_STORE, initialize ? "readwrite" : "readonly");
    const store = tx.objectStore(RUBBER_NUMBER_STORE), request = store.get(locationId);
    request.onsuccess = () => {
      if (validState(request.result)) result = request.result;
      else if (initialize) {
        result = { key: locationId, version: 1, installationId: crypto.randomUUID(), generationId: crypto.randomUUID(),
          counters: {}, reservations: {}, checkedAt: 0 };
        store.put(result);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function rubberNumberingReady(locationId: string) {
  const current = await state(locationId);
  return Boolean(current?.issuer && isRubberBillIssuer(current.issuer) && current.issuer.locationId === locationId);
}
export async function prepareRubberBillIssuer(locationId: string, refresh = false) {
  const running = flights.get(locationId);
  if (running) return running;
  const promise = (async () => {
    const before = await state(locationId, true);
    if (!before || (!refresh && before.issuer && Date.now() - before.checkedAt < 60000)) return;
    const response = await authFetch("/api/lanflow/rubber-bills/issuers", { method: "POST",
      headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ locationId, installationId: before.installationId, generationId: before.generationId }) });
    await assertApiResponse(response);
    const issuer: unknown = await response.json();
    if (!isRubberBillIssuer(issuer) || issuer.locationId !== locationId) throw new Error("ข้อมูลรหัสเครื่องไม่ถูกต้อง");
    const db = await getSyncDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RUBBER_NUMBER_STORE, "readwrite"), store = tx.objectStore(RUBBER_NUMBER_STORE);
      const request = store.get(locationId);
      request.onsuccess = () => {
        const current = request.result as NumberState | undefined;
        if (!validState(current) || current.installationId !== before.installationId || current.generationId !== before.generationId) return;
        const old = current.issuer?.code.slice(1).replace(/^0+/, "") ?? "";
        const next = issuer.code.slice(1).replace(/^0+/, "");
        if (old.length > next.length || (old.length === next.length && old > next)) return;
        store.put({ ...current, issuer, checkedAt: Date.now(), counters: current.issuer?.id === issuer.id ? current.counters : {} });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  })().finally(() => { flights.delete(locationId); });
  flights.set(locationId, promise);
  return promise;
}

/** One durable commit owns number assignment and the command; no network work occurs here. */
export async function enqueueNumberedRubberCreate<T extends RubberBill>(event: Omit<SyncEvent, "queueId">, bill: T) {
  const db = await getSyncDb();
  return new Promise<{ event: SyncEvent; bill: T }>((resolve, reject) => {
    let result: { event: SyncEvent; bill: T } | undefined, failure: Error | undefined;
    const tx = db.transaction([RUBBER_NUMBER_STORE, SYNC_QUEUE_STORE], "readwrite");
    const numbers = tx.objectStore(RUBBER_NUMBER_STORE), queue = tx.objectStore(SYNC_QUEUE_STORE);
    const request = numbers.get(event.locationId);
    request.onsuccess = () => {
      const current = request.result as NumberState | undefined;
      if (!validState(current) || !isRubberBillIssuer(current.issuer) || current.issuer.locationId !== event.locationId) {
        failure = new Error(message); tx.abort(); return;
      }
      const issuer = current.issuer;
      const pending = queue.index("id").getAll(event.id);
      pending.onsuccess = () => {
        if ((pending.result as SyncEvent[]).some(row => row.ownerUserId === event.ownerUserId && row.locationId === event.locationId && row.entity === event.entity)) {
          failure = new Error("ข้อมูลบิลเปลี่ยนจากอีกแท็บ กรุณาตรวจรายการก่อนลองใหม่"); tx.abort(); return;
        }
        let reservation = current.reservations[event.id];
        if (!reservation) {
          const sequence = (current.counters[bill.billDate] ?? 0) + 1;
          if (!Number.isSafeInteger(sequence)) { failure = new Error("เลขลำดับเกินขอบเขตที่รองรับ"); tx.abort(); return; }
          reservation = { base: rubberBaseNumber(bill.billDate, sequence, issuer.code),
            metadata: { version: 1, issuerId: issuer.id, date: bill.billDate, sequence } };
          current.counters[bill.billDate] = sequence;
          current.reservations[event.id] = reservation;
          numbers.put(current);
        }
        const numberedBill = { ...bill, localBillNo: reservation.base, billNo: reservation.base, billNumbering: reservation.metadata };
        const numbered = { ...event, payload: { ...event.payload, localBillNo: reservation.base, billNumbering: reservation.metadata } };
        const add = queue.add(numbered);
        add.onsuccess = () => { result = { bill: numberedBill, event: { ...numbered, queueId: Number(add.result) } }; };
      };
    };
    tx.oncomplete = () => { db.close(); if (result) resolve(result); else reject(new Error(message)); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? tx.error ?? new Error(message)); };
  });
}
