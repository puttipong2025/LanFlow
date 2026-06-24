"use client";

export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: "same-origin"
  });
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
