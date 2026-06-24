"use client";

/**
 * Authenticated fetch wrapper.
 * Automatically injects the JWT from localStorage into the Authorization header.
 * Falls back to a normal fetch if no token is found (for unauthenticated routes).
 */

const TOKEN_KEY = "lanflow:auth-token";

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = readToken();

  const headers = new Headers(init?.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, {
    ...init,
    headers,
  });
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
