"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { authFetch } from "@/lib/auth-fetch";

export type RubberBillOcrDraft = {
  billDate: string | null;
  inWeight: number | null;
  outWeight: number | null;
  deductWeight: number | null;
  ocrTotal: number | null;
  suggestedPrice: number | null;
};

export type RubberBillOcrInitialDraft = RubberBillOcrDraft & {
  uploadId: string;
};

export type RubberBillOcrQueueItem = {
  id: string;
  locationId: string;
  file: File;
  previewUrl: string;
  status: "pending" | "processing" | "ready" | "error" | "reviewing";
  uploadId?: string;
  draft?: RubberBillOcrDraft;
  errorMessage?: string;
  retryable?: boolean;
};

type OcrApiResponse = {
  uploadId?: string;
  draft?: Partial<RubberBillOcrDraft>;
  code?: string;
  message?: string;
  retryable?: boolean;
};

function makeQueueId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorFromResponse(response: Response, body: OcrApiResponse) {
  const error = new Error(body.message || `อ่านใบชั่งไม่สำเร็จ (${response.status})`);
  return Object.assign(error, { retryable: body.retryable !== false });
}

export function isRetryableOcrFailure(cause: unknown) {
  return !(
    cause
    && typeof cause === "object"
    && "retryable" in cause
    && (cause as { retryable?: unknown }).retryable === false
  );
}

export function requeueRubberBillOcrItem(
  items: RubberBillOcrQueueItem[],
  id: string,
): RubberBillOcrQueueItem[] {
  return items.map((item) => item.id === id && item.status === "error"
    ? { ...item, status: "pending", errorMessage: undefined, retryable: undefined }
    : item);
}

export function nextPendingRubberBillOcrItem(
  items: RubberBillOcrQueueItem[],
  processing: boolean,
) {
  return processing ? null : items.find((item) => item.status === "pending") ?? null;
}

export function useRubberBillOcrQueue({
  items,
  setItems,
  online,
}: {
  items: RubberBillOcrQueueItem[];
  setItems: React.Dispatch<React.SetStateAction<RubberBillOcrQueueItem[]>>;
  online: boolean;
}) {
  const processingRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const updateItem = useCallback((id: string, update: Partial<RubberBillOcrQueueItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }, [setItems]);

  const processItem = useCallback(async (item: RubberBillOcrQueueItem) => {
    if (!online || item.status === "processing" || item.status === "reviewing") return;
    updateItem(item.id, { status: "processing", errorMessage: undefined, retryable: undefined });
    try {
      const formData = new FormData();
      formData.append("image", item.file);
      formData.append("locationId", item.locationId);
      const response = await authFetch("/api/lanflow/rubber-bills/ocr", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({})) as OcrApiResponse;
      if (!response.ok || !body.uploadId || !body.draft) throw errorFromResponse(response, body);
      updateItem(item.id, {
        status: "ready",
        uploadId: body.uploadId,
        draft: {
          billDate: body.draft.billDate ?? null,
          inWeight: body.draft.inWeight ?? null,
          outWeight: body.draft.outWeight ?? null,
          deductWeight: body.draft.deductWeight ?? null,
          ocrTotal: body.draft.ocrTotal ?? null,
          suggestedPrice: body.draft.suggestedPrice ?? null,
        },
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("อ่านใบชั่งไม่สำเร็จ");
      updateItem(item.id, {
        status: "error",
        errorMessage: error.message,
        retryable: isRetryableOcrFailure(error),
      });
    }
  }, [online, updateItem]);

  const processNext = useCallback(async () => {
    if (!online || processingRef.current) return;
    const next = nextPendingRubberBillOcrItem(itemsRef.current, processingRef.current);
    if (!next) return;
    processingRef.current = true;
    try {
      await processItem(next);
    } finally {
      processingRef.current = false;
    }
  }, [online, processItem]);

  useEffect(() => {
    void processNext();
  }, [items, processNext]);

  const addFiles = useCallback((locationId: string, files: FileList | File[]) => {
    if (!online) return { accepted: 0, rejected: Array.from(files).length };
    const accepted = Array.from(files).filter((file) => file.type === "image/jpeg" || file.type === "image/png");
    if (accepted.length > 0) {
      setItems((current) => [...current, ...accepted.map((file) => ({
        id: makeQueueId(), locationId, file, previewUrl: URL.createObjectURL(file), status: "pending" as const,
      }))]);
    }
    return { accepted: accepted.length, rejected: Array.from(files).length - accepted.length };
  }, [online, setItems]);

  const retry = useCallback((id: string) => {
    if (!online) return;
    setItems((current) => requeueRubberBillOcrItem(current, id));
  }, [online, setItems]);

  const setReviewing = useCallback((id: string) => updateItem(id, { status: "reviewing" }), [updateItem]);
  const restoreReady = useCallback((id: string) => updateItem(id, { status: "ready" }), [updateItem]);
  const remove = useCallback((id: string) => {
    setItems((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((candidate) => candidate.id !== id);
    });
  }, [setItems]);

  return {
    items,
    countByLocation: useMemo(() => items.reduce<Record<string, number>>((counts, item) => {
      counts[item.locationId] = (counts[item.locationId] ?? 0) + 1;
      return counts;
    }, {}), [items]),
    addFiles,
    retry,
    setReviewing,
    restoreReady,
    remove,
  };
}
