import { getConnectivitySnapshot, subscribeConnectivity } from "@/lib/connectivity";
import { isCacheInterval } from "./settings";

// A hidden/offline page has no timer. Returning starts a fresh full interval;
// reconnect's immediate check remains owned by the existing coordinator.
export function startCacheVersionTimer(readMinutes: () => number | null | undefined, check: () => Promise<void>) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer);
    const minutes = readMinutes();
    if (disposed || document.hidden || !getConnectivitySnapshot() || minutes == null || !isCacheInterval(minutes)) return;
    timer = setTimeout(() => {
      if (disposed || document.hidden || !getConnectivitySnapshot()) return;
      void check().finally(reset);
    }, minutes * 60_000);
  };
  document.addEventListener("visibilitychange", reset);
  const unsubscribe = subscribeConnectivity(reset);
  reset();
  return { reset, stop: () => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", reset);
    unsubscribe();
  } };
}
