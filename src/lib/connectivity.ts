type ConnectivityListener = () => void;

const listeners = new Set<ConnectivityListener>();
let listening = false;
let onlineSnapshot = false;

export function isDeviceOnline() {
  return typeof navigator !== "undefined" && navigator.onLine;
}

function updateSnapshot() {
  const nextSnapshot = isDeviceOnline();
  if (nextSnapshot === onlineSnapshot) return;
  onlineSnapshot = nextSnapshot;
  for (const listener of listeners) listener();
}

function startListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  onlineSnapshot = isDeviceOnline();
  window.addEventListener("online", updateSnapshot);
  window.addEventListener("offline", updateSnapshot);
}

function stopListening() {
  if (!listening || typeof window === "undefined") return;
  listening = false;
  window.removeEventListener("online", updateSnapshot);
  window.removeEventListener("offline", updateSnapshot);
}

export function subscribeConnectivity(listener: ConnectivityListener) {
  listeners.add(listener);
  startListening();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopListening();
  };
}

export function getConnectivitySnapshot() {
  return listening ? onlineSnapshot : isDeviceOnline();
}

export function getServerConnectivitySnapshot() {
  return false;
}
