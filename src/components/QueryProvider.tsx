"use client";

import dynamic from "next/dynamic";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from "@/lib/connectivity";
import { abortNetworkRequests } from "@/lib/network-abort";
import { flushPendingFormDrafts } from "@/lib/form-drafts";

const ReactQueryDevtools = process.env.NODE_ENV === "development"
  ? dynamic(
      () => import("@tanstack/react-query-devtools").then((module) => module.ReactQueryDevtools),
      { ssr: false },
    )
  : null;

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const wasOfflineRef = useRef(false);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      const syncOnline = () => setOnline(getConnectivitySnapshot());
      syncOnline();
      return subscribeConnectivity(syncOnline);
    });
  }, []);

  useEffect(() => subscribeConnectivity(() => {
    if (!getConnectivitySnapshot()) {
      wasOfflineRef.current = true;
      void queryClient.cancelQueries();
      abortNetworkRequests();
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    if (!navigator.serviceWorker?.controller) return;
    void flushPendingFormDrafts()
      .then(() => window.location.reload())
      .catch((error) => {
        console.error("Form drafts could not be saved before reconnect", error);
      });
  }), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}
