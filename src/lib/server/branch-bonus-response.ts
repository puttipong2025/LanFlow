import { NextResponse } from "next/server";

export const bonusHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export function bonusResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: bonusHeaders });
}
export function bonusError(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  const known = [
    ["BONUS_FORBIDDEN:", 403], ["BONUS_NOT_FOUND:", 404],
    ["BONUS_INVALID:", 400], ["BONUS_CONFLICT:", 409], ["BONUS_SOURCE_CHANGED:", 409], ["BONUS_HISTORY_LOCKED:", 409],
  ] as const;
  const match = known.find(([prefix]) => message.startsWith(prefix));
  return match ? bonusResponse({ error: message.slice(match[0].length).trim(), code: match[0].slice(0, -1) }, match[1])
    : bonusResponse({ error: "ระบบโบนัสยังไม่พร้อมใช้งาน กรุณาลองใหม่" }, 503);
}
