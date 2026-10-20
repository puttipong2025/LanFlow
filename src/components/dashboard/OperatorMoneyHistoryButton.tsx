"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { Profile } from "@/types";

const loadHistoryDialog = () => import("./OperatorMoneyHistoryDialog");
const HistoryDialog = dynamic(loadHistoryDialog, { ssr: false });
const preloadHistoryDialog = () => { void loadHistoryDialog().catch(() => undefined); };

export function OperatorMoneyHistoryButton({ profile, online }: { profile: Profile; online: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const scope = `${profile.id}:${profile.canAccessSystemManager}:${profile.locationIds.slice().sort().join(",")}`;
  if (profile.role !== "admin" && profile.role !== "super_admin") return null;
  return <>
    <button ref={button} type="button" disabled={!online} onClick={() => setOpen(true)}
      onPointerEnter={preloadHistoryDialog} onFocus={preloadHistoryDialog}
      className="focus-ring min-h-11 whitespace-nowrap rounded-md border border-black/15 bg-white px-3 text-sm font-semibold disabled:opacity-50">
      ตรวจประวัติผู้สร้างรายการ
    </button>
    {open && <HistoryDialog key={scope} ownerScope={scope} online={online} returnFocusElement={button.current} onClose={() => setOpen(false)} />}
  </>;
}
