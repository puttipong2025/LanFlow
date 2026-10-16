"use client";

import { Layers3, Plus, WifiOff } from "lucide-react";

export function MoneyTransferHeaderActions({ online, selectorOpen, onToggleSelector, onOpenBundle, onSelectType }: {
  online: boolean;
  selectorOpen: boolean;
  onToggleSelector: () => void;
  onOpenBundle: () => void;
  onSelectType: (type: "customer" | "transport" | "branch") => void;
}) {
  const offlineMessage = "โอนเงินใช้ได้เมื่อออนไลน์เท่านั้น";
  return <div className="flex w-full flex-wrap gap-2 sm:w-auto">
    <button type="button" onClick={onOpenBundle} disabled={!online}
      className="focus-ring inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-actionSecondary px-4 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none">
      <Layers3 size={16} /> สร้างชุดจ่ายรวม
    </button>
    <div className="relative flex-1 sm:flex-none">
      <button type="button" onClick={onToggleSelector} disabled={!online} title={online ? undefined : offlineMessage}
        className="focus-ring flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-leaf px-4 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
        {online ? <Plus size={16} /> : <WifiOff size={16} />} สร้างรายการโอน
      </button>
      {selectorOpen && <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-black/10 bg-white py-1 shadow-xl">
        <button type="button" onClick={() => onSelectType("customer")} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-leaf focus:bg-leaf">💰 โอนให้ลูกค้า</button>
        <button type="button" onClick={() => onSelectType("transport")} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-leaf focus:bg-leaf">🚛 จ่ายค่าขนส่ง</button>
        <button type="button" onClick={() => onSelectType("branch")} className="focus-ring w-full bg-actionSecondary px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-leaf focus:bg-leaf">🏢 โอนให้สาขา</button>
      </div>}
    </div>
  </div>;
}
