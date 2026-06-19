"use client";

import { useEffect, useMemo, useState } from "react";
import type { QueueItem } from "@/types";

const STORAGE_KEY = "lanflow:offline-queue";

function readQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as QueueItem[];
  } catch {
    return [];
  }
}

export function useOfflineQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setItems(readQueue());
    setOnline(window.navigator.onLine);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  }, [items]);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === "pending" || item.status === "failed").length,
    [items]
  );

  function enqueue(item: Omit<QueueItem, "status" | "createdAt">) {
    setItems((current) => [
      {
        ...item,
        status: "pending",
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
  }

  function markAllSynced() {
    const serverReceivedAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => ({
        ...item,
        status: "synced",
        serverReceivedAt,
        errorMessage: undefined
      }))
    );
  }

  function markSynced(idempotencyKey: string) {
    const serverReceivedAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.idempotencyKey === idempotencyKey
          ? { ...item, status: "synced", serverReceivedAt, errorMessage: undefined }
          : item
      )
    );
  }

  function markFailed(idempotencyKey: string, errorMessage: string) {
    setItems((current) =>
      current.map((item) =>
        item.idempotencyKey === idempotencyKey
          ? { ...item, status: "failed", errorMessage }
          : item
      )
    );
  }

  function clearSynced() {
    setItems((current) => current.filter((item) => item.status !== "synced"));
  }

  return { items, online, pendingCount, enqueue, markAllSynced, markSynced, markFailed, clearSynced };
}
