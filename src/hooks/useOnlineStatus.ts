import { useSyncExternalStore } from "react";
import {
  getConnectivitySnapshot,
  getServerConnectivitySnapshot,
  subscribeConnectivity,
} from "@/lib/connectivity";

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getServerConnectivitySnapshot,
  );
}
