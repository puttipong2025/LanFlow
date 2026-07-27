import { useCallback, useEffect, useRef, useState } from "react";

import { shareReceiptPdf, type ShareReceiptPdfResult } from "@/lib/rubber-bills/print-receipt";

type SharePdfDocument = {
  html: string;
  filename: string;
};

export function useSharePdf() {
  const controllerRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setWaiting(false);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const sharePdf = useCallback(async (
    buildDocument: (signal: AbortSignal) => Promise<SharePdfDocument> | SharePdfDocument,
  ): Promise<ShareReceiptPdfResult> => {
    if (controllerRef.current) return "cancelled";

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setWaiting(true);

    try {
      const document = await buildDocument(controller.signal);
      if (controller.signal.aborted) return "cancelled";
      return await shareReceiptPdf(document.html, document.filename, {
        signal: controller.signal,
        onBeforeHandoff: async () => {
          setWaiting(false);
          await new Promise<void>((resolve) => requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve())
          ));
        },
      });
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "name" in error
        && error.name === "AbortError"
      ) return "cancelled";
      throw error;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
      setWaiting(false);
    }
  }, []);

  return {
    busy,
    waiting,
    cancel,
    sharePdf,
  };
}
