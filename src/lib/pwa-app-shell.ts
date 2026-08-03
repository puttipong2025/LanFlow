const APP_SHELL_CACHE = "lanflow-start-url";

export async function cacheAuthenticatedAppShell() {
  if (
    process.env.NODE_ENV !== "production" ||
    typeof window === "undefined" ||
    !navigator.onLine ||
    !("serviceWorker" in navigator) ||
    !("caches" in window)
  ) {
    return;
  }

  try {
    await navigator.serviceWorker.ready;

    const request = new Request(new URL("/", window.location.origin), {
      cache: "no-store",
      credentials: "same-origin",
    });
    const response = await fetch(request);
    if (!response.ok || response.redirected) return;

    const cache = await window.caches.open(APP_SHELL_CACHE);
    await cache.put(request, response);
  } catch {
    // App-shell caching must never affect an authenticated session.
  }
}
