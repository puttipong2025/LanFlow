import { useCallback, useEffect, useRef, useState } from "react";

import { shareReceiptPdf, type ShareReceiptPdfResult } from "@/lib/rubber-bills/print-receipt";

type SharePdfDocument = {
  html: string;
  filename: string;
};

type SharePdfFileDocument = {
  file: File;
  title: string;
};

function abortError() {
  return new DOMException("ยกเลิกการแชร์ PDF", "AbortError");
}

function downloadPdfFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

async function deliverPdfFile(
  document: SharePdfFileDocument,
  signal: AbortSignal,
  onBeforeHandoff: () => Promise<void>,
): Promise<ShareReceiptPdfResult> {
  signal.throwIfAborted();
  await onBeforeHandoff();
  signal.throwIfAborted();

  if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files: [document.file] })) {
        await navigator.share({ files: [document.file], title: document.title });
        return "shared";
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }

  signal.throwIfAborted();
  downloadPdfFile(document.file);
  return "downloaded";
}

export function useSharePdf() {
  const controllerRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setWaiting(false);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const runShare = useCallback(async (
    share: (
      signal: AbortSignal,
      onBeforeHandoff: () => Promise<void>,
    ) => Promise<ShareReceiptPdfResult>,
  ) => {
    if (controllerRef.current) return "cancelled";

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setWaiting(true);
    const onBeforeHandoff = async () => {
      setWaiting(false);
      await new Promise<void>((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve())
      ));
      if (controller.signal.aborted) throw abortError();
    };

    try {
      return await share(controller.signal, onBeforeHandoff);
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

  const sharePdf = useCallback((
    buildDocument: (signal: AbortSignal) => Promise<SharePdfDocument> | SharePdfDocument,
  ) => runShare(async (signal, onBeforeHandoff) => {
    const document = await buildDocument(signal);
    signal.throwIfAborted();
    return shareReceiptPdf(document.html, document.filename, {
      signal,
      onBeforeHandoff,
    });
  }), [runShare]);

  const sharePdfFile = useCallback((
    buildDocument: (signal: AbortSignal) => Promise<SharePdfFileDocument> | SharePdfFileDocument,
  ) => runShare(async (signal, onBeforeHandoff) => {
    const document = await buildDocument(signal);
    signal.throwIfAborted();
    return deliverPdfFile(document, signal, onBeforeHandoff);
  }), [runShare]);

  return {
    busy,
    waiting,
    cancel,
    sharePdf,
    sharePdfFile,
  };
}
