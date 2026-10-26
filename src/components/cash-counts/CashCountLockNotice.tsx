"use client";
import { useEffect, useState } from "react";
import type { CashCountLockState } from "@/lib/cash-count-lock";
import { cn } from "@/lib/cn";

export function CashCountLockNotice({ state, offset, working, onUnlock, onOpen }: {
  state: CashCountLockState; offset: number; working: boolean; onUnlock: () => void; onOpen?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.unlockedUntil || state.locked) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.unlockedUntil, state.locked]);
  if (!state.enabled) return null;
  const seconds = state.unlockedUntil ? Math.max(0, Math.ceil((Date.parse(state.unlockedUntil) - now - offset) / 1000)) : 0;
  if (!state.locked && !seconds) return null;
  return <section aria-label={`สถานะล็อก ${state.locationName}`} className={cn("space-y-2 rounded-lg border p-3 tabular-nums", state.locked ? "border-clay/30 bg-clay/10" : "border-leaf/30 bg-mint/45")}>
    <h4 className="text-balance text-sm font-bold">{state.locationName} · {state.locked ? "ถูกล็อกงานการเงิน" : "ปลดล็อกชั่วคราว"}</h4>
    <p className="text-pretty text-sm">{state.locked ? "เกินกำหนดนับเงิน ยังดูข้อมูลและนับเงินได้ หากมีงานค้างต้องปลดล็อกเพื่อจัดการก่อนเริ่มนับ" : `เหลือ ${Math.floor(seconds / 3600)} ชม. ${Math.floor(seconds % 3600 / 60)} นาที ${seconds % 60} วินาที`}</p>
    {state.locked && !state.canUnlock && <p className="text-pretty text-sm">กรุณาติดต่อ {state.contacts.map((p) => p.name).join(", ") || "ผู้ดูแลระบบที่มีสิทธิ์ปลดล็อก"}</p>}
    {!state.locked && state.unlockedByName && <p className="text-pretty text-sm text-ink/65">ปลดล็อกโดย {state.unlockedByName}</p>}
    <div className="flex flex-wrap gap-2">{onOpen && <button type="button" onClick={onOpen} className="focus-ring min-h-11 rounded-md bg-river px-3 text-sm font-semibold text-white">เปิดแจ้งเตือนนับเงิน</button>}
      {state.locked && state.canUnlock && <button type="button" onClick={onUnlock} disabled={working} className="focus-ring min-h-11 rounded-md bg-leaf px-3 text-sm font-semibold text-white disabled:opacity-50">{working ? "กำลังปลดล็อก…" : "ปลดล็อกชั่วคราว"}</button>}</div>
  </section>;
}
