"use client";

import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState } from "react";
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from "@/lib/connectivity";
import { abortNetworkRequests } from "@/lib/network-abort";
import { flushPendingFormDrafts } from "@/lib/form-drafts";

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
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
