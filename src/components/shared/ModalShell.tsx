"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function ModalShell({
  title,
  subtitle,
  onClose,
  size = "normal",
  mobileFullScreen = false,
  closeOnEscape = false,
  closeDisabled = false,
  role = "dialog",
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  size?: "normal" | "wide";
  mobileFullScreen?: boolean;
  closeOnEscape?: boolean;
  closeDisabled?: boolean;
  role?: "dialog" | "alertdialog";
  children: React.ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!closeOnEscape || closeDisabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, closeOnEscape, onClose]);

  return (
    <div className={cn(
      "fixed inset-0 z-50 flex items-start justify-center bg-ink/50 p-2 sm:p-6",
      mobileFullScreen && "p-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] sm:p-6",
    )}>
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden rounded-xl border border-white/80 bg-white shadow-2xl sm:mt-4 sm:max-h-[calc(100dvh-48px)]",
          size === "wide" ? "max-w-6xl" : "max-w-4xl",
          mobileFullScreen && "h-dvh max-h-dvh rounded-none border-0 sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:rounded-xl sm:border",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-mint bg-sand px-3 py-3 sm:px-4">
          <div>
            <h2 id={titleId} className="text-balance text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-pretty text-sm text-ink/60">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label={closeDisabled ? "กำลังดำเนินการ ไม่สามารถปิดได้" : "ปิด"}
            onClick={onClose}
            disabled={closeDisabled}
            className="focus-ring inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-actionSecondary px-3 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <X size={17} />
            ปิด
          </button>
        </div>
        <div className="modal-scroll-body flex-1 overflow-y-auto p-3 sm:p-4">{children}</div>
      </div>
    </div>
  );
}
