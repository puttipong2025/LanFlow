export type AuthAccessFailure = {
  message: string;
  status: 401 | 403 | 503;
};

type UpstreamErrorShape = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

type AuthAccessFailureInput = {
  assignmentsError: unknown;
  hasProfile: boolean;
  isActive: boolean;
  profileError: unknown;
};

type AuthClaimsFailureInput = {
  claimsError: unknown;
  hasUserId: boolean;
};

const AUTHENTICATION_REQUIRED: AuthAccessFailure = {
  message: "ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ",
  status: 401,
};

const AUTH_SERVICE_UNAVAILABLE: AuthAccessFailure = {
  message: "ระบบยืนยันสิทธิ์ชั่วคราวไม่พร้อมใช้งาน",
  status: 503,
};

export function classifyAuthAccessFailure({
  assignmentsError,
  hasProfile,
  isActive,
  profileError,
}: AuthAccessFailureInput): AuthAccessFailure | null {
  if (profileError || assignmentsError) {
    return AUTH_SERVICE_UNAVAILABLE;
  }

  if (!hasProfile || !isActive) {
    return {
      message: "บัญชีถูกปิดใช้งาน หรือไม่มีสิทธิ์เข้าถึง",
      status: 403,
    };
  }

  return null;
}

export function classifyAuthClaimsFailure({
  claimsError,
  hasUserId,
}: AuthClaimsFailureInput): AuthAccessFailure | null {
  if (!claimsError && hasUserId) return null;
  if (!claimsError) return AUTHENTICATION_REQUIRED;

  const value = claimsError as UpstreamErrorShape;
  const status = typeof value.status === "number" ? value.status : undefined;
  const name = typeof value.name === "string" ? value.name : "";
  const message = typeof value.message === "string" ? value.message : "";
  const isRetryable = (status !== undefined && status >= 500)
    || name === "AuthRetryableFetchError"
    || /fetch failed|network|connection|timed? out|timeout|temporar(?:y|ily) unavailable/i.test(message);

  return isRetryable
    ? AUTH_SERVICE_UNAVAILABLE
    : AUTHENTICATION_REQUIRED;
}

export function summarizeUpstreamError(error: unknown) {
  if (!error || typeof error !== "object") return null;

  const value = error as UpstreamErrorShape;
  const rawMessage = typeof value.message === "string"
    ? value.message.replace(/\s+/g, " ").trim()
    : "";
  const message = /<(?:!doctype|html)\b/i.test(rawMessage)
    ? "upstream returned an HTML error response"
    : rawMessage.slice(0, 240) || undefined;

  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message,
    name: typeof value.name === "string" ? value.name : undefined,
    status: typeof value.status === "number" ? value.status : undefined,
  };
}
