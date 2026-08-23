import { NextResponse } from "next/server";

type ErrorLike = { message?: string } | null | undefined;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function managementErrorResponse(error: ErrorLike, fallback: string) {
  const message = error?.message ?? "";
  const known = [
    { prefix: "FORBIDDEN:", status: 403 },
    { prefix: "RUBBER_GROUP_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_LOCATION_NOT_FOUND:", status: 404 },
    { prefix: "ADMIN_USER_NOT_FOUND:", status: 404 },
    { prefix: "ADMIN_AUDIT_NOT_FOUND:", status: 404 },
    { prefix: "RUBBER_GROUP_BRANCH_CONFLICT:", status: 409 },
    { prefix: "ADMIN_REQUEST_CONFLICT:", status: 409 },
    { prefix: "RUBBER_GROUP_EMPTY:", status: 400 },
    { prefix: "RUBBER_GROUP_INVALID:", status: 400 },
    { prefix: "ADMIN_PROFILE_INVALID:", status: 400 },
    { prefix: "ADMIN_AUDIT_INVALID:", status: 400 },
  ].find(({ prefix }) => message.includes(prefix));

  if (!known) {
    return NextResponse.json({ errorMessage: fallback }, { status: 500 });
  }
  const errorMessage = message.slice(message.indexOf(known.prefix) + known.prefix.length).trim();
  return NextResponse.json({ errorMessage }, { status: known.status });
}

export async function managementAuthFailure(response: NextResponse) {
  let errorMessage = "ไม่มีสิทธิ์เข้าถึง";
  try {
    const payload = await response.clone().json() as { error?: string; errorMessage?: string };
    errorMessage = payload.errorMessage ?? payload.error ?? errorMessage;
  } catch {
    // Keep the stable public message when an upstream auth response is not JSON.
  }
  return NextResponse.json(
    { errorMessage },
    { status: response.status, headers: response.headers },
  );
}
