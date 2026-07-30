import { useSyncExternalStore } from "react";

type ServiceHealthListener = () => void;

const listeners = new Set<ServiceHealthListener>();
const unavailableRequests = new Set<string>();

function requestKey(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw, typeof window === "undefined" ? "http://localhost" : window.location.origin)
      .pathname;
  } catch {
    return raw;
  }
}

function notifyIfChanged(wasUnavailable: boolean) {
  if (wasUnavailable === (unavailableRequests.size > 0)) return;
  for (const listener of listeners) listener();
}

export function recordServiceResponse(input: RequestInfo | URL, status: number) {
  const wasUnavailable = unavailableRequests.size > 0;
  const key = requestKey(input);
  if (status >= 500) unavailableRequests.add(key);
  else unavailableRequests.delete(key);
  notifyIfChanged(wasUnavailable);
}

export function recordServiceFailure(input: RequestInfo | URL) {
  const wasUnavailable = unavailableRequests.size > 0;
  unavailableRequests.add(requestKey(input));
  notifyIfChanged(wasUnavailable);
}

function subscribeServiceHealth(listener: ServiceHealthListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServiceUnavailableSnapshot() {
  return unavailableRequests.size > 0;
}

export function useServiceUnavailable() {
  return useSyncExternalStore(
    subscribeServiceHealth,
    getServiceUnavailableSnapshot,
    () => false,
  );
}
