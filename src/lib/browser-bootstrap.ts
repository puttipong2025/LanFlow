"use client";

// Serialize first cookie issuance across tabs. Server deduplicates requests by
// account/hash once issued; this lock prevents first-load tabs issuing two cookies.
export async function bootstrapBrowserApproval(action: "bootstrap" | "resubmit" = "bootstrap") {
  const run = () => fetch("/api/auth/browser", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(10_000),
  });
  return navigator.locks ? navigator.locks.request("lanflow-browser-cookie", run) : run();
}
