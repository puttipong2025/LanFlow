"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
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
  renderInPortal = false,
  nativeModal = false,
  role = "dialog",
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  size?: "compact" | "normal" | "wide";
  mobileFullScreen?: boolean;
  closeOnEscape?: boolean;
  closeDisabled?: boolean;
  renderInPortal?: boolean;
  nativeModal?: boolean;
  role?: "dialog" | "alertdialog";
  children: React.ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!closeOnEscape || closeDisabled || nativeModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, closeOnEscape, nativeModal, onClose]);

  useEffect(() => {
    if (!nativeModal) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [nativeModal]);

  const modal = (
    <div className={cn(
      "fixed inset-0 z-50 flex items-start justify-center bg-ink/50 p-2 sm:p-6",
      mobileFullScreen && "!p-0 sm:!p-6",
    )}>
      <div
        role={nativeModal ? undefined : role}
        aria-modal={nativeModal ? undefined : "true"}
        aria-labelledby={nativeModal ? undefined : titleId}
        className={cn(
          "flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden rounded-xl border border-white/80 bg-white shadow-2xl sm:mt-4 sm:max-h-[calc(100dvh-48px)]",
          size === "wide" ? "max-w-6xl" : size === "compact" ? "max-w-md" : "max-w-4xl",
          mobileFullScreen && "h-dvh max-h-dvh rounded-none border-0 sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:rounded-xl sm:border",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-mint bg-sand px-3 py-3 sm:px-4">
          <div>
            <h2 id={titleId} className="text-balance text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-pretty text-sm text-ink/60">{subtitle}</p>}
          </div>
          <button
            autoFocus={nativeModal}
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
  const accessibleModal = nativeModal ? (
    <dialog
      ref={dialogRef}
      role={role}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscape && !closeDisabled) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0"
    >
      {modal}
    </dialog>
  ) : modal;
  return renderInPortal && typeof document !== "undefined"
    ? createPortal(accessibleModal, document.body)
    : accessibleModal;
}
