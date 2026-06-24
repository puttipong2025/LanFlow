"use client";

import type {
  Customer,
  IncomeExpense,
  Location,
  MoneyTransfer,
  OcrTicket,
  Profile,
  RubberBill,
  TransportStaff
} from "@/types";
import { OFFLINE_AUTH_MAX_AGE_MS } from "@/hooks/use-auth";

export type OfflineWorkspace = {
  savedAt: string;
  profile: Profile;
  locations: Location[];
  bills: RubberBill[];
  transactions: IncomeExpense[];
  customers: Customer[];
  transportStaffs: TransportStaff[];
  ocrTickets: OcrTicket[];
  moneyTransfers: MoneyTransfer[];
  usedSourceIds: string[];
};

function workspaceKey(userId: string) {
  return `lanflow:workspace:${userId}`;
}

export function readOfflineWorkspace(userId: string): OfflineWorkspace | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(workspaceKey(userId));
    if (!raw) return null;

    const workspace = JSON.parse(raw) as OfflineWorkspace;
    const savedAt = new Date(workspace.savedAt).getTime();
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > OFFLINE_AUTH_MAX_AGE_MS) {
      window.localStorage.removeItem(workspaceKey(userId));
      return null;
    }

    return workspace;
  } catch {
    return null;
  }
}

export function writeOfflineWorkspace(
  userId: string,
  workspace: Omit<OfflineWorkspace, "savedAt">
) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    workspaceKey(userId),
    JSON.stringify({
      ...workspace,
      savedAt: new Date().toISOString()
    } satisfies OfflineWorkspace)
  );
}

