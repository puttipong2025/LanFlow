import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteFormDraft,
  registerDraftFlusher,
  readFormDraft,
  writeFormDraft,
  type FormDraftPartition,
} from "@/lib/form-drafts";

export function usePersistentFormDraft<T>({
  partition,
  enabled,
  value,
  onRestore,
  debounceMs = 300,
}: {
  partition: FormDraftPartition;
  enabled: boolean;
  value: T;
  onRestore: (draft: T) => void;
  debounceMs?: number;
}) {
  const stablePartition = useMemo(
    () => ({
      ownerUserId: partition.ownerUserId,
      locationId: partition.locationId,
      formType: partition.formType,
    }),
    [partition.formType, partition.locationId, partition.ownerUserId],
  );
  const onRestoreRef = useRef(onRestore);
  const latestValueRef = useRef(value);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<Promise<void>>(Promise.resolve());
  const [hydrated, setHydrated] = useState(!enabled);
  const hydratedRef = useRef(!enabled);
  latestValueRef.current = value;
  hydratedRef.current = hydrated;

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (!enabled) {
      setHydrated(true);
      return;
    }

    let active = true;
    setHydrated(false);
    void readFormDraft<T>(stablePartition)
      .then((draft) => {
        if (!active) return;
        if (draft) onRestoreRef.current(draft);
        setHydrated(true);
      })
      .catch((error) => {
        console.error("Form draft restore failed", error);
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [enabled, stablePartition]);

  const flushDraft = useCallback(async () => {
    if (!enabled || !hydratedRef.current) return;
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const write = pendingWriteRef.current
      .catch(() => {})
      .then(() => writeFormDraft(stablePartition, latestValueRef.current));
    pendingWriteRef.current = write;
    await write;
  }, [enabled, stablePartition]);

  useEffect(() => {
    if (!enabled || !hydrated) return;

    writeTimerRef.current = setTimeout(() => {
      void flushDraft().catch((error) => {
        console.error("Form draft save failed", error);
      });
    }, debounceMs);

    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
  }, [debounceMs, enabled, flushDraft, hydrated, value]);

  useEffect(() => {
    if (!enabled) return;
    return registerDraftFlusher(flushDraft);
  }, [enabled, flushDraft]);

  const clearDraft = useCallback(async () => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    await pendingWriteRef.current;
    await deleteFormDraft(stablePartition);
  }, [stablePartition]);

  return { clearDraft, hydrated };
}
