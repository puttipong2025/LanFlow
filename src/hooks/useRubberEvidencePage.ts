"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import { evidenceImageKey, type EvidenceDetail } from "@/lib/rubber-evidence/slides";

const IMAGE_CONCURRENCY = 3;

type PageBill = { id: string; revisionNo: number };
type ImageTask = { billId: string; key: string; url: string };

type PageState = {
  details: Record<string, EvidenceDetail>;
  detailErrors: Record<string, string>;
  imageUrls: Record<string, string>;
  imageErrors: Record<string, string>;
  pendingImagesByBill: Record<string, number>;
  waiting: boolean;
  phase: "idle" | "preparing" | "background" | "complete" | "cancelled";
  preparedFirstImages: number;
  totalFirstImages: number;
  requestCount: number;
  compressedBytes: number;
  firstUsableMs: number | null;
};

const EMPTY_STATE: PageState = {
  details: {},
  detailErrors: {},
  imageUrls: {},
  imageErrors: {},
  pendingImagesByBill: {},
  waiting: false,
  phase: "idle",
  preparedFirstImages: 0,
  totalFirstImages: 0,
  requestCount: 0,
  compressedBytes: 0,
  firstUsableMs: null,
};

function imageTasks(detail: EvidenceDetail): ImageTask[] {
  const tasks: ImageTask[] = [];
  const rows = [...detail.rows].sort((left, right) => (
    left.sequenceNo - right.sequenceNo || left.id.localeCompare(right.id)
  ));
  for (const row of rows) {
    const entries = [
      ["displayIn", row.displayInImageUrl],
      ["displayOut", row.displayOutImageUrl],
    ] as const;
    for (const [role, url] of entries) {
      if (!url) continue;
      tasks.push({
        billId: detail.bill.id,
        key: evidenceImageKey(detail.bill.id, detail.bill.revisionNo, row.id, role),
        url,
      });
    }
  }
  const rubberRow = [...rows].reverse().find((row) => Boolean(row.rubberImageUrl));
  if (rubberRow?.rubberImageUrl) {
    tasks.push({
      billId: detail.bill.id,
      key: evidenceImageKey(detail.bill.id, detail.bill.revisionNo, rubberRow.id, "rubber"),
      url: rubberRow.rubberImageUrl,
    });
  }
  return tasks;
}

async function runPool(tasks: ImageTask[], worker: (task: ImageTask) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      await worker(task);
    }
  }));
}

export function useRubberEvidencePage(bills: PageBill[], online: boolean) {
  const [state, setState] = useState<PageState>(EMPTY_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new Map<string, { objectUrl: string; bytes: number }>());
  const detailCacheRef = useRef(new Map<string, EvidenceDetail>());
  const inFlight = useRef(new Map<string, Promise<{ objectUrl: string; bytes: number }>>());

  const clearCache = useCallback(() => {
    for (const item of cacheRef.current.values()) URL.revokeObjectURL(item.objectUrl);
    cacheRef.current.clear();
    detailCacheRef.current.clear();
    inFlight.current.clear();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const inFlightMap = inFlight.current;
    controllerRef.current = controller;
    if (bills.length === 0) {
      clearCache();
      setState(EMPTY_STATE);
      return () => controller.abort();
    }
    if (!online) {
      setState((current) => ({ ...current, waiting: false }));
      return () => controller.abort();
    }

    const startedAt = performance.now();
    setState({ ...EMPTY_STATE, waiting: true, phase: "preparing" });

    async function loadImage(task: ImageTask) {
      const cached = cacheRef.current.get(task.key);
      if (cached) return { ...cached, requested: false };
      const existing = inFlightMap.get(task.key);
      if (existing) return { ...await existing, requested: false };

      const promise = (async () => {
        const response = await authFetch(task.url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`เปิดรูปไม่สำเร็จ (${response.status})`);
        const blob = await response.blob();
        const result = { objectUrl: URL.createObjectURL(blob), bytes: blob.size };
        cacheRef.current.set(task.key, result);
        return result;
      })();
      inFlightMap.set(task.key, promise);
      try {
        return { ...await promise, requested: true };
      } finally {
        if (inFlightMap.get(task.key) === promise) inFlightMap.delete(task.key);
      }
    }

    async function prepare() {
      const results = await Promise.all(bills.map(async (bill) => {
        const detailKey = `${bill.id}:${bill.revisionNo}`;
        const cached = detailCacheRef.current.get(detailKey);
        if (cached) return { billId: bill.id, detail: cached };
        try {
          const response = await authFetch(
            `/api/lanflow/evidence/bills/${bill.id}/revisions/${bill.revisionNo}/detail`,
            { signal: controller.signal, cache: "no-store" },
          );
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "เปิดรายละเอียดหลักฐานไม่สำเร็จ");
          const detail = payload as EvidenceDetail;
          detailCacheRef.current.set(detailKey, detail);
          return { billId: bill.id, detail };
        } catch (error) {
          if (controller.signal.aborted) throw error;
          return {
            billId: bill.id,
            error: error instanceof Error ? error.message : "เปิดรายละเอียดหลักฐานไม่สำเร็จ",
          };
        }
      }));
      if (controller.signal.aborted) return;

      const details: Record<string, EvidenceDetail> = {};
      const detailErrors: Record<string, string> = {};
      for (const result of results) {
        if (result.detail) details[result.billId] = result.detail;
        else if (result.error) detailErrors[result.billId] = result.error;
      }

      const allTasks = Object.values(details).flatMap(imageTasks);
      const activeDetailKeys = new Set(bills.map((bill) => `${bill.id}:${bill.revisionNo}`));
      const activeImageKeys = new Set(allTasks.map((task) => task.key));
      for (const key of detailCacheRef.current.keys()) {
        if (!activeDetailKeys.has(key)) detailCacheRef.current.delete(key);
      }
      for (const [key, item] of cacheRef.current) {
        if (activeImageKeys.has(key)) continue;
        URL.revokeObjectURL(item.objectUrl);
        cacheRef.current.delete(key);
      }
      const pendingImagesByBill: Record<string, number> = {};
      for (const bill of bills) pendingImagesByBill[bill.id] = 0;
      for (const task of allTasks) pendingImagesByBill[task.billId] += 1;

      const firstTasks = Object.values(details).flatMap((detail) => {
        const firstRow = [...detail.rows].sort((left, right) => left.sequenceNo - right.sequenceNo)[0];
        const firstUrl = firstRow?.displayInImageUrl ?? firstRow?.displayOutImageUrl;
        const firstRole = firstRow?.displayInImageUrl ? "displayIn" : "displayOut";
        if (!firstRow || !firstUrl) return [];
        return [{
          billId: detail.bill.id,
          key: evidenceImageKey(detail.bill.id, detail.bill.revisionNo, firstRow.id, firstRole),
          url: firstUrl,
        }];
      });

      setState((current) => ({
        ...current,
        details,
        detailErrors,
        pendingImagesByBill,
        totalFirstImages: firstTasks.length,
      }));

      const work = async (task: ImageTask, isFirst: boolean) => {
        try {
          const result = await loadImage(task);
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            imageUrls: { ...current.imageUrls, [task.key]: result.objectUrl },
            pendingImagesByBill: {
              ...current.pendingImagesByBill,
              [task.billId]: Math.max((current.pendingImagesByBill[task.billId] ?? 1) - 1, 0),
            },
            requestCount: current.requestCount + (result.requested ? 1 : 0),
            compressedBytes: current.compressedBytes + (result.requested ? result.bytes : 0),
            preparedFirstImages: current.preparedFirstImages + (isFirst ? 1 : 0),
          }));
        } catch (error) {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            imageErrors: {
              ...current.imageErrors,
              [task.key]: error instanceof Error ? error.message : "เปิดรูปไม่สำเร็จ",
            },
            pendingImagesByBill: {
              ...current.pendingImagesByBill,
              [task.billId]: Math.max((current.pendingImagesByBill[task.billId] ?? 1) - 1, 0),
            },
            requestCount: current.requestCount + 1,
            preparedFirstImages: current.preparedFirstImages + (isFirst ? 1 : 0),
          }));
        }
      };

      await runPool(firstTasks, (task) => work(task, true));
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        waiting: false,
        phase: "background",
        firstUsableMs: Math.round(performance.now() - startedAt),
      }));

      const firstKeys = new Set(firstTasks.map((task) => task.key));
      await runPool(allTasks.filter((task) => !firstKeys.has(task.key)), (task) => work(task, false));
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, phase: "complete" }));
      }
    }

    const startTimer = window.setTimeout(() => void prepare(), 0);
    return () => {
      window.clearTimeout(startTimer);
      controller.abort();
      inFlightMap.clear();
    };
  }, [bills, clearCache, online, reloadToken]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    clearCache();
  }, [clearCache]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    clearCache();
    setState((current) => ({
      ...current,
      imageUrls: {},
      waiting: false,
      phase: "cancelled",
    }));
  }, [clearCache]);

  return {
    ...state,
    cancel,
    retry: () => setReloadToken((value) => value + 1),
  };
}
