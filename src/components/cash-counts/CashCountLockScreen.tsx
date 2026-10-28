"use client";
import { ModalShell } from "@/components/shared/ModalShell";
import type { CashCountLockState } from "@/lib/cash-count-lock";
import type { Location } from "@/types";
import { useState } from "react";

export function CashCountLockScreen({ state, locations, locationId, online, error, working, remaining, onChange, onCheck, onUnlock, onLogout }: {
  state?: CashCountLockState; locations: Location[]; locationId: string; online: boolean;
  error: string | null; working: boolean; remaining: number;
  onChange: (id: string) => unknown; onCheck: () => unknown; onUnlock: () => unknown; onLogout: () => unknown;
}) {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true); setLogoutError(null);
    try { await onLogout(); }
    catch { setLogoutError("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setLoggingOut(false); }
  }
  return <ModalShell nativeModal renderInPortal hideClose closeDisabled role="alertdialog" size="compact" mobileFullScreen
    title={state?.locked ? "สาขาถูกล็อก" : "กำลังตรวจสถานะสาขา"} onClose={() => {}}>
    <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
      <p className="text-pretty font-semibold">{locations.find((location) => location.id === locationId)?.name}</p>
      {state?.locked && <p className="text-pretty text-sm tabular-nums">เกินกำหนดนับเงิน · กำหนด {new Date(`${state.dueDate}T00:00:00+07:00`).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" })}</p>}
      {state?.locked && !state.canUnlock && <p className="text-pretty text-sm">ติดต่อ {state.contacts.map((contact) => contact.name).join(", ") || "ผู้ดูแลระบบที่มีสิทธิ์ปลดล็อก"}</p>}
      <p className="text-pretty text-sm tabular-nums">{online ? `ตรวจสถานะอีกครั้งใน ${remaining} วินาที` : "ไม่มีอินเทอร์เน็ต · เชื่อมต่อเพื่อตรวจสถานะ"}</p>
      {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
      {logoutError && <p role="alert" className="text-pretty text-sm text-clay">{logoutError}</p>}
      {locations.length > 1 && <label className="block space-y-1 text-sm font-semibold">เปลี่ยนสาขา<select value={locationId} disabled={!online || working} onChange={(event) => onChange(event.target.value)} className="focus-ring min-h-11 w-full rounded-md border border-black/15 bg-white px-3">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
      <div className="flex flex-wrap gap-2">
        {state?.locked && state.canUnlock && <button type="button" disabled={!online || working} onClick={onUnlock} className="focus-ring min-h-11 rounded-md bg-leaf px-3 text-sm font-semibold text-white disabled:opacity-50">{working ? "กำลังปลดล็อก…" : "ปลดล็อกชั่วคราว"}</button>}
        <button type="button" disabled={!online || working} onClick={onCheck} className="focus-ring min-h-11 rounded-md bg-river px-3 text-sm font-semibold text-white disabled:opacity-50">ตรวจสถานะอีกครั้ง</button>
        <button type="button" disabled={!online || working || loggingOut} onClick={() => void logout()} className="focus-ring min-h-11 rounded-md border border-black/15 bg-white px-3 text-sm font-semibold disabled:opacity-50">{loggingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}</button>
      </div>
    </div>
  </ModalShell>;
}
