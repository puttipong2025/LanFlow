import { bangkokDateString } from "@/lib/bangkok-date";

export const MAX_WEIGHING_APPOINTMENT_NUMBER = 9_999;

type PendingReservation = {
  number: number;
  token: string;
  issuedDay: string;
};

type CounterState = {
  version: 1;
  date: string;
  lastIssued: number;
  pending: PendingReservation | null;
};

type CounterScope = {
  locationId: string;
  storage: Storage;
  now?: Date;
};

type ReservationInput = CounterScope & {
  expectedNumber: number;
  token: string;
};

type ReservationTokenInput = CounterScope & {
  token: string;
};

export class WeighingAppointmentCounterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeighingAppointmentCounterError";
  }
}

export function getWeighingAppointmentCounterKey(locationId: string) {
  return `lanflow:weighing-appointment-counter:v1:${encodeURIComponent(locationId)}`;
}

export function getWeighingAppointmentBrowserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function emptyState(now: Date): CounterState {
  return {
    version: 1,
    date: bangkokDateString(now),
    lastIssued: 0,
    pending: null,
  };
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseState(raw: string): CounterState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WeighingAppointmentCounterError("ข้อมูลเลขคิวบัตรนัดเสียหาย");
  }

  if (!value || typeof value !== "object") {
    throw new WeighingAppointmentCounterError("ข้อมูลเลขคิวบัตรนัดไม่ถูกต้อง");
  }

  const candidate = value as Record<string, unknown>;
  const pending = candidate.pending as Record<string, unknown> | null;
  const validPending =
    pending === null ||
    (pending &&
      hasExactKeys(pending, ["number", "token", "issuedDay"]) &&
      isIntegerBetween(pending.number, 1, MAX_WEIGHING_APPOINTMENT_NUMBER) &&
      typeof pending.token === "string" &&
      pending.token.length > 0 &&
      pending.issuedDay === candidate.date);

  if (
    !hasExactKeys(candidate, ["version", "date", "lastIssued", "pending"]) ||
    candidate.version !== 1 ||
    !isIsoDate(candidate.date) ||
    !isIntegerBetween(candidate.lastIssued, 0, MAX_WEIGHING_APPOINTMENT_NUMBER) ||
    !validPending ||
    (pending !== null && pending.number !== Number(candidate.lastIssued) + 1)
  ) {
    throw new WeighingAppointmentCounterError("ข้อมูลเลขคิวบัตรนัดไม่ถูกต้อง");
  }

  return candidate as CounterState;
}

function readState(scope: CounterScope): CounterState {
  const now = scope.now ?? new Date();
  const key = getWeighingAppointmentCounterKey(scope.locationId);
  let raw: string | null;
  try {
    raw = scope.storage.getItem(key);
  } catch {
    throw new WeighingAppointmentCounterError("ไม่สามารถอ่านเลขคิวบัตรนัดจากอุปกรณ์นี้ได้");
  }

  if (raw === null) return emptyState(now);

  const state = parseState(raw);
  return state.date === bangkokDateString(now) ? state : emptyState(now);
}

function writeState(scope: CounterScope, state: CounterState) {
  const key = getWeighingAppointmentCounterKey(scope.locationId);
  const raw = JSON.stringify(state);
  try {
    scope.storage.setItem(key, raw);
    if (scope.storage.getItem(key) !== raw) {
      throw new Error("counter verification failed");
    }
  } catch {
    throw new WeighingAppointmentCounterError("ไม่สามารถบันทึกเลขคิวบัตรนัดบนอุปกรณ์นี้ได้");
  }
}

function nextNumber(state: CounterState) {
  const lastReserved = state.pending?.number ?? state.lastIssued;
  if (lastReserved >= MAX_WEIGHING_APPOINTMENT_NUMBER) {
    throw new WeighingAppointmentCounterError("เลขคิวบัตรนัดของวันนี้ครบ 9,999 แล้ว");
  }
  return lastReserved + 1;
}

export function previewWeighingAppointmentNumber(scope: CounterScope) {
  return nextNumber(readState(scope));
}

export function reserveWeighingAppointmentNumber(input: ReservationInput) {
  const now = input.now ?? new Date();
  const issuedDay = bangkokDateString(now);
  const current = readState({ ...input, now });
  const recovered: CounterState = current.pending
    ? { ...current, lastIssued: current.pending.number, pending: null }
    : current;
  const availableNumber = nextNumber(recovered);

  if (input.expectedNumber !== availableNumber) {
    if (recovered !== current) writeState(input, recovered);
    return { kind: "changed" as const, nextNumber: availableNumber };
  }

  const reserved: CounterState = {
    ...recovered,
    pending: {
      number: availableNumber,
      token: input.token,
      issuedDay,
    },
  };
  writeState(input, reserved);
  return { kind: "reserved" as const, number: availableNumber };
}

export function commitWeighingAppointmentNumber(input: ReservationTokenInput) {
  const current = readState(input);
  if (!current.pending || current.pending.token !== input.token) {
    throw new WeighingAppointmentCounterError("ไม่พบการจองเลขคิวบัตรนัดที่กำลังใช้งาน");
  }
  writeState(input, {
    ...current,
    lastIssued: current.pending.number,
    pending: null,
  });
}

export function rollbackWeighingAppointmentNumber(input: ReservationTokenInput) {
  const current = readState(input);
  if (!current.pending || current.pending.token !== input.token) {
    throw new WeighingAppointmentCounterError("ไม่พบการจองเลขคิวบัตรนัดที่กำลังใช้งาน");
  }
  writeState(input, { ...current, pending: null });
}
