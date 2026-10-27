"use client";

import { abortableFetch } from "@/lib/network-abort";
import { CASH_COUNT_OVERDUE_CODE } from "@/lib/cash-count-lock";

export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await abortableFetch(url, {
    ...init,
    credentials: "same-origin"
  });
  if (response.status === 401 && typeof window !== "undefined") {
    const body = await response.clone().json().catch(() => ({}));
    if (["OTP_REQUIRED", "SESSION_REVOKED", "PASSWORD_REQUIRED"].includes(body?.errorCode)) {
      window.dispatchEvent(new CustomEvent("lanflow:auth-required", { detail: body.errorCode }));
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
  }
  if (response.status === 409 && typeof window !== "undefined") {
    const body = await response.clone().json().catch(() => ({}));
    if (body?.errorCode === CASH_COUNT_OVERDUE_CODE) window.dispatchEvent(new Event("lanflow:cash-count-lock-changed"));
  }
  if (response.ok && typeof window !== "undefined" && init?.method && init.method !== "GET"
    && /^\/api\/lanflow\/(cash-counts|cash-count-alert\/groups)(\/|\?|$)/.test(url)) {
    window.dispatchEvent(new Event("lanflow:cash-count-lock-changed"));
    try { localStorage.setItem("lanflow:cash-count-lock-changed", String(Date.now())); } catch { /* Storage is optional. */ }
  }
  return response;
}

export async function assertApiResponse(response: Response): Promise<void> {
  if (response.ok) return;

  let message = response.statusText || "Request failed";
  try {
    const body = await response.clone().json() as { error?: string };
    if (body.error) message = body.error;
  } catch {
    const text = await response.text();
    if (text) message = text;
  }

  throw new ApiResponseError(response.status, message);
}

/** Revalidate before touching a persisted queue, including on reconnect. */
export async function canSyncCurrentSession(ownerUserId: string, locationId?: string): Promise<boolean> {
  try {
    const response = await authFetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    return data.profile?.id === ownerUserId && ["admin", "super_admin"].includes(data.profile?.role)
      && (!locationId || data.profile?.locationIds?.includes(locationId) === true);
  } catch { return false; }
}

/**
 * Like authFetch, but for JSON payloads.
 * Sets Content-Type automatically.
 */
export function authFetchJson(
  url: string,
  method: string,
  body: unknown,
  extraInit?: RequestInit
): Promise<Response> {
  return authFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(extraInit?.headers as Record<string, string>),
    },
    body: JSON.stringify(body),
    ...extraInit,
  });
}
