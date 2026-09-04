"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertDialog } from "@/components/shared/AlertDialog";
import {
  acknowledgeBranchCreateGuardState,
  buildBranchCreateChoices,
  readBranchCreateGuardState,
  reconcileBranchCreateGuardState,
  requiresBranchCreateConfirmation,
  writeBranchCreateGuardState,
  type BranchCreateChoice,
  type BranchCreateGuardContext,
  type BranchCreateGuardState,
} from "@/lib/lanflow/branch-create-guard";

export type BranchCreateApproval = { locationId: string };
export type RequestBranchCreate = (options?: { requiresOnline?: boolean }) => Promise<BranchCreateApproval | null>;

const BRANCH_MISMATCH_TOAST_ID = "branch-create-guard-mismatch";

type PendingRequest = {
  userId: string;
  context: BranchCreateGuardContext;
  choices: BranchCreateChoice[];
  requiresOnline: boolean;
  settled: boolean;
  resolve: (approval: BranchCreateApproval | null) => void;
};

export function useBranchCreateGuard({
  userId,
  primaryLocationId,
  activeLocationId,
  managedLocations,
  isLoaded,
  online,
}: {
  userId: string;
  primaryLocationId: string | null;
  activeLocationId: string;
  managedLocations: BranchCreateChoice[];
  isLoaded: boolean;
  online: boolean;
}) {
  const [dialogMounted, setDialogMounted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const stateRef = useRef<BranchCreateGuardState | null>(null);
  const stateUserIdRef = useRef("");
  const contextRef = useRef<BranchCreateGuardContext | null>(null);
  const managedLocationsRef = useRef(managedLocations);
  const onlineRef = useRef(online);
  const pendingRef = useRef<PendingRequest | null>(null);
  const closedResultRef = useRef<BranchCreateApproval | null>(null);
  const closedErrorRef = useRef<string | null>(null);

  const context = useMemo<BranchCreateGuardContext>(() => ({
    primaryLocationId,
    activeLocationId,
  }), [activeLocationId, primaryLocationId]);

  const finishAfterClose = useCallback((
    result: BranchCreateApproval | null,
    errorMessage: string | null = null,
  ) => {
    if (!pendingRef.current || pendingRef.current.settled) return;
    pendingRef.current.settled = true;
    closedResultRef.current = result;
    closedErrorRef.current = errorMessage;
    setDialogOpen(false);
  }, []);

  useEffect(() => {
    onlineRef.current = online;
    if (!online && pendingRef.current?.requiresOnline) finishAfterClose(null);
  }, [finishAfterClose, online]);

  useEffect(() => {
    managedLocationsRef.current = managedLocations;
  }, [managedLocations]);

  useEffect(() => {
    contextRef.current = isLoaded && userId && activeLocationId ? context : null;
    if (!contextRef.current) {
      stateRef.current = null;
      stateUserIdRef.current = "";
      finishAfterClose(null);
      return;
    }

    const source = stateUserIdRef.current === userId
      ? stateRef.current
      : readBranchCreateGuardState(userId);
    const next = reconcileBranchCreateGuardState(source, context);
    stateRef.current = next;
    stateUserIdRef.current = userId;
    writeBranchCreateGuardState(userId, next);

    const pending = pendingRef.current;
    if (pending && (
      pending.userId !== userId
      || pending.context.activeLocationId !== context.activeLocationId
      || pending.context.primaryLocationId !== context.primaryLocationId
    )) finishAfterClose(null);
  }, [activeLocationId, context, finishAfterClose, isLoaded, userId]);

  useEffect(() => () => {
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
  }, []);

  const requestBranchCreate = useCallback((options?: { requiresOnline?: boolean }) => {
    toast.dismiss(BRANCH_MISMATCH_TOAST_ID);
    const currentContext = contextRef.current;
    const currentState = stateRef.current;
    if (!currentContext || !currentState || stateUserIdRef.current !== userId) {
      return Promise.resolve(null);
    }
    if (options?.requiresOnline && !onlineRef.current) return Promise.resolve(null);
    if (pendingRef.current) return Promise.resolve(null);
    const currentManagedLocations = managedLocationsRef.current;
    if (!requiresBranchCreateConfirmation(
      currentState,
      currentContext,
      currentManagedLocations.map((location) => location.id),
    )) {
      return Promise.resolve({ locationId: currentContext.activeLocationId });
    }
    const choices = buildBranchCreateChoices(
      currentManagedLocations,
      currentContext.activeLocationId,
    );
    if (choices.length < 2) return Promise.resolve(null);

    let resolveRequest!: (approval: BranchCreateApproval | null) => void;
    const promise = new Promise<BranchCreateApproval | null>((resolve) => {
      resolveRequest = resolve;
    });
    pendingRef.current = {
      userId,
      context: currentContext,
      choices,
      requiresOnline: options?.requiresOnline ?? false,
      settled: false,
      resolve: resolveRequest,
    };
    closedResultRef.current = null;
    closedErrorRef.current = null;
    setDialogMounted(true);
    setDialogOpen(true);
    return promise;
  }, [userId]);

  const selectChoice = useCallback((locationId: string) => {
    const pending = pendingRef.current;
    const currentContext = contextRef.current;
    const currentState = stateRef.current;
    if (!pending || pending.settled || !currentContext || !currentState) return;
    const unchanged = pending.userId === userId
      && stateUserIdRef.current === userId
      && pending.context.activeLocationId === currentContext.activeLocationId
      && pending.context.primaryLocationId === currentContext.primaryLocationId
      && currentState.activeLocationId === currentContext.activeLocationId
      && currentState.primaryLocationId === currentContext.primaryLocationId
      && managedLocationsRef.current.some(
        (location) => location.id === currentContext.activeLocationId,
      );
    if (!unchanged || (pending.requiresOnline && !onlineRef.current)) {
      finishAfterClose(null);
      return;
    }
    if (locationId !== currentContext.activeLocationId) {
      finishAfterClose(
        null,
        "เลือกสาขาไม่ตรงกับสาขาปัจจุบัน กรุณาตรวจสอบใหม่",
      );
      return;
    }

    const acknowledged = acknowledgeBranchCreateGuardState(currentState);
    stateRef.current = acknowledged;
    writeBranchCreateGuardState(userId, acknowledged);
    finishAfterClose({ locationId: currentContext.activeLocationId });
  }, [finishAfterClose, userId]);

  const handleClosed = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const currentContext = contextRef.current;
    const resultStillValid = currentContext
      && pending.userId === stateUserIdRef.current
      && pending.context.activeLocationId === currentContext.activeLocationId
      && pending.context.primaryLocationId === currentContext.primaryLocationId
      && (!pending.requiresOnline || onlineRef.current)
      && managedLocationsRef.current.some(
        (location) => location.id === currentContext.activeLocationId,
      );
    const result = resultStillValid ? closedResultRef.current : null;
    const errorMessage = closedErrorRef.current;
    pendingRef.current = null;
    closedResultRef.current = null;
    closedErrorRef.current = null;
    setDialogMounted(false);
    pending.resolve(result);
    if (errorMessage) toast.error(errorMessage, {
      id: BRANCH_MISMATCH_TOAST_ID,
      closeButton: true,
      duration: Infinity,
      position: "bottom-center",
    });
  }, []);

  const choices = pendingRef.current?.choices ?? [];
  const branchCreateDialog = dialogMounted ? (
    <AlertDialog
      open={dialogOpen}
      title="ยืนยันสาขาก่อนสร้างรายการ"
      description="เลือกสาขาที่คุณกำลังทำรายการอยู่"
      confirmLabel={null}
      onCancel={() => finishAfterClose(null)}
      onClosed={handleClosed}
    >
      <fieldset className="mt-4 grid gap-2">
        <legend className="sr-only">เลือกสาขาปัจจุบัน</legend>
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-label={`เลือกสาขา ${choice.name}`}
            onClick={() => selectChoice(choice.id)}
            className="focus-ring min-h-11 rounded-lg border border-river/25 bg-white px-4 py-3 text-left text-sm font-semibold text-ink hover:border-river/50 hover:bg-field"
          >
            {choice.name}
          </button>
        ))}
      </fieldset>
    </AlertDialog>
  ) : null;

  return { requestBranchCreate, branchCreateDialog };
}
